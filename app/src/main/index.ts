import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import * as path from 'path';
import { startServer } from './server';
import { killAllProcesses } from './services/process-manager';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

async function createWindow() {
  // Set dock icon in development mode on macOS
  if (isDev && process.platform === 'darwin') {
    // __dirname is dist/main/, so we need to go up 2 levels to app/ then into build/
    const iconPath = path.join(__dirname, '../../build/icon-dev.png');
    console.log('Setting dock icon from:', iconPath);
    const icon = nativeImage.createFromPath(iconPath);
    console.log('Icon isEmpty:', icon.isEmpty());
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
      console.log('Dock icon set successfully');
    }
  }

  // Start HTTP server (used by both Electron and browser modes)
  await startServer();
  console.log('HTTP server started');

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

  if (isDev) {
    // In development, load from Vite dev server
    // Wait a bit for Vite to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from bundled frontend files
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
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
  console.log('Application quitting...');
  killAllProcesses();
});

// Core IPC handlers (app control)
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
