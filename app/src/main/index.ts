import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { startServer } from './server';

let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

async function createWindow() {
  // Start the backend server
  serverPort = await startServer();
  console.log(`Backend server started on port ${serverPort}`);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  // In production, load from the Express server serving static files
  if (isDev) {
    // Wait a bit for Vite to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, recreate window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  // Cleanup will happen when the process exits
  console.log('Application quitting...');
});

// IPC handlers
ipcMain.handle('get-version', () => {
  return app.getVersion();
});

ipcMain.handle('show-open-dialog', async (_event, options: Electron.OpenDialogOptions) => {
  if (!mainWindow) {
    throw new Error('No main window');
  }
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.on('app-quit', () => {
  app.quit();
});

ipcMain.on('app-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('app-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
