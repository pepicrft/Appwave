import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electron', {
  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Dialog methods
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('show-open-dialog', options),

  // App control
  quit: () => ipcRenderer.send('app-quit'),
  minimize: () => ipcRenderer.send('app-minimize'),
  maximize: () => ipcRenderer.send('app-maximize'),

  // Platform info
  platform: process.platform,
});

// Type declaration for the exposed API
declare global {
  interface Window {
    electron: {
      getVersion: () => Promise<string>;
      showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
      quit: () => void;
      minimize: () => void;
      maximize: () => void;
      platform: NodeJS.Platform;
    };
  }
}
