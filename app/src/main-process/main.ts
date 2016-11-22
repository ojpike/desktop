import { app, Menu, MenuItem, ipcMain, BrowserWindow } from 'electron'

import { AppWindow } from './app-window'
import { buildDefaultMenu, MenuEvent, findMenuItemByID } from './menu'
import { parseURL } from '../lib/parse-url'
import { handleSquirrelEvent } from './updates'
import { SharedProcess } from '../shared-process/shared-process'
import { fatalError } from '../lib/fatal-error'
import { reportError } from '../lib/exception-reporting'

let mainWindow: AppWindow | null = null
let sharedProcess: SharedProcess | null = null

let network: Electron.Net | null = null

const launchTime = Date.now()

let readyTime: number | null = null

process.on('uncaughtException', (error: Error) => {
  if (sharedProcess) {
    sharedProcess.console.error('Uncaught exception:')
    sharedProcess.console.error(error.name)
    sharedProcess.console.error(error.message)
  }

  reportError(error, app.getVersion())
})

if (__WIN32__ && process.argv.length > 1) {
  if (handleSquirrelEvent(process.argv[1])) {
    app.quit()
  }
}

const shouldQuit = app.makeSingleInstance((commandLine, workingDirectory) => {
  // Someone tried to run a second instance, we should focus our window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }

  // look at the second argument received, it should have the OAuth
  // callback contents and code for us to complete the signin flow
  if (commandLine.length > 1) {
    const action = parseURL(commandLine[1])
    getMainWindow().sendURLAction(action)
  }
})

if (shouldQuit) {
  app.quit()
}

app.on('ready', () => {
  const now = Date.now()
  readyTime = now - launchTime

  // the network module can only be resolved after the app is ready
  const { net } = require('electron')
  network = net

  // TODO: drain queued requests now that we have a valid module

  app.setAsDefaultProtocolClient('x-github-client')
  // Also support Desktop Classic's protocols.
  if (__DARWIN__) {
    app.setAsDefaultProtocolClient('github-mac')
  } else if (__WIN32__) {
    app.setAsDefaultProtocolClient('github-windows')
  }

  sharedProcess = new SharedProcess()
  sharedProcess.register()

  createWindow()

  app.on('open-url', (event, url) => {
    event.preventDefault()

    const action = parseURL(url)
    getMainWindow().sendURLAction(action)
  })

  const menu = buildDefaultMenu(sharedProcess)
  Menu.setApplicationMenu(menu)

  ipcMain.on('menu-event', (event, args) => {
    const { name }: { name: MenuEvent } = event as any
    if (mainWindow) {
      mainWindow.sendMenuEvent(name)
    }
  })

  ipcMain.on('set-menu-enabled', (event: Electron.IpcMainEvent, { id, enabled }: { id: string, enabled: boolean }) => {
    const menuItem = findMenuItemByID(menu, id)
    if (menuItem) {
      menuItem.enabled = enabled
    } else {
      fatalError(`Unknown menu id: ${id}`)
    }
  })

  ipcMain.on('set-menu-visible', (event: Electron.IpcMainEvent, { id, visible }: { id: string, visible: boolean }) => {
    const menuItem = findMenuItemByID(menu, id)
    if (menuItem) {
      menuItem.visible = visible
    } else {
      fatalError(`Unknown menu id: ${id}`)
    }
  })

  ipcMain.on('show-contextual-menu', (event: Electron.IpcMainEvent, items: ReadonlyArray<any>) => {
    const menu = new Menu()
    const menuItems = items.map((item, i) => {
      return new MenuItem({
        label: item.label,
        click: () => event.sender.send('contextual-menu-action', i),
      })
    })

    for (const item of menuItems) {
      menu.append(item)
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    menu.popup(window)
  })

  ipcMain.on('proxy/request', (event: Electron.IpcMainEvent, { guid, options, body}: { guid: string, options: Electron.RequestOptions, body: string | Buffer | undefined}) => {

    if (network === null) {
      // TODO: defer requests to be executed afterwards
      // TODO: return a promise ready to go
      return
    }

    // TODO: add default parameters?

    const promise = new Promise<Electron.IncomingMessage>((resolve, reject) => {

      const req = network!.request(options)

      if (body) {
        req.write(body)
      }

      req.on('login', auth => {
        // TODO: grab this information and attempt to complete flow
      })

      req.on('response', response => {

        // TODO: handle proxy response
        // TODO: other event handling

        response.on('error', error => {
          // TODO: how to fail here?
        })

        response.on('end', () => {
          // TODO: success?
        })
      })
    })

    // TODO: do we need to pass in this id again?
    // TODO: this should be a promise
    event.sender.send(`proxy/response/${guid}`, promise)
  })
})

app.on('activate', () => {
  if (!mainWindow) {
    createWindow()
  }
})

function createWindow() {
  const window = new AppWindow(sharedProcess!)
  window.onClose(() => {
    mainWindow = null

    if (!__DARWIN__) {
      app.quit()
    }
  })

  window.onDidLoad(() => {
    window.show()
    window.sendLaunchTimingStats({
      mainReadyTime: readyTime!,
      loadTime: window.loadTime!,
      rendererReadyTime: window.rendererReadyTime!,
    })
  })

  window.load()

  mainWindow = window
}

/** Get the main window, creating it if necessary. */
function getMainWindow(): AppWindow {
  if (!mainWindow) {
    createWindow()
  }

  return mainWindow!
}
