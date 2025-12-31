import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';

export async function checkForUpdates() {
  try {
    const update = await check();

    if (update) {
      console.log(`Update available: ${update.version}`);

      const yes = await ask(
        `Update to ${update.version} is available!\n\nRelease notes: ${update.body}`,
        {
          title: 'Update Available',
          kind: 'info',
          okLabel: 'Update',
          cancelLabel: 'Later'
        }
      );

      if (yes) {
        console.log('Downloading and installing update...');
        await update.downloadAndInstall();

        // Relaunch the app to apply the update
        await relaunch();
      }
    } else {
      console.log('No updates available');
    }
  } catch (error) {
    console.error('Update check failed:', error);
  }
}
