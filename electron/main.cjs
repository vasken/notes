const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
} = require('electron');

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

app.setName('Local Notes');

// Explicit, stable data directory for both development
// and packaged desktop runs.
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'Local Notes'),
);

const PORT = 5187;

let localServer = null;
let mainWindow = null;
let quitting = false;
let shutdownStarted = false;

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) mainWindow.restore();

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(start)
    .catch(error => {
      dialog.showErrorBox(
        'Local Notes could not start',
        error.stack || error.message || String(error),
      );

      app.quit();
    });
}

async function openExternal(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:'
    ) {
      await shell.openExternal(parsed.href);
    }
  } catch (error) {
    console.error('Could not open external link:', error);
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    title: 'Local Notes',
    width: 1400,
    height: 900,
    minWidth: 850,
    minHeight: 600,
    backgroundColor: '#ffffff',
    show: false,

    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === localServer.origin) {
        return;
      }
    } catch {
      // Invalid URLs are blocked below.
    }

    event.preventDefault();
    void openExternal(url);
  });

  window.webContents.on('will-attach-webview', event => {
    event.preventDefault();
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    dialog.showErrorBox(
      'Local Notes renderer stopped',
      `Reason: ${details.reason}\n\nReopen the window from the Dock.`,
    );
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  await window.loadURL(localServer.origin);

  if (!window.isDestroyed()) {
    window.show();
  }
}

async function start() {
  const dataDirectory = app.getPath('userData');

  await fs.mkdir(dataDirectory, { recursive: true });

  // Must be set before importing api.mjs.
  process.env.NOTES_DATA_DIR = dataDirectory;

  const token = randomBytes(32).toString('hex');

  const serverModule = pathToFileURL(
    path.join(__dirname, 'local-server.mjs'),
  ).href;

  const { startLocalServer } = await import(serverModule);

  localServer = await startLocalServer({
    appDirectory: app.getAppPath(),
    port: PORT,
    token,
  });

  const desktopSession = session.defaultSession;

  desktopSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );

  desktopSession.setPermissionCheckHandler(() => false);

  await desktopSession.cookies.set({
    url: localServer.origin,
    name: 'local_notes_session',
    value: token,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Local Notes',
      submenu: [
        { role: 'about' },
        {
          label: 'Open Data Folder',
          click: () => {
            void shell.openPath(dataDirectory);
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Show Notes',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              void createWindow().catch(error => {
                dialog.showErrorBox(
                  'Could not open Local Notes',
                  String(error),
                );
              });
            }
          },
        },
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
  ]));

  await createWindow();

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      return;
    }

    void createWindow().catch(error => {
      dialog.showErrorBox(
        'Could not open Local Notes',
        String(error),
      );
    });
  });
}

// Closing the window on macOS keeps the application and
// its local server running until Cmd+Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  if (quitting || !localServer) return;

  event.preventDefault();

  if (shutdownStarted) return;
  shutdownStarted = true;

  void localServer.close()
    .catch(error => {
      console.error('Could not stop local server:', error);
    })
    .finally(() => {
      quitting = true;
      app.quit();
    });
});
