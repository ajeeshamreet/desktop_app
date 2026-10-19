// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("athena", {
    registerListenerForTimerTickFromMain: (callback) => {
        const fn = (_event, message) => {
            callback(message);
        };

        ipcRenderer.on('timer', fn);

        return () => {
            ipcRenderer.removeListener('timer', fn);
        };
    },

    startTimerOnMain: () => {
        return ipcRenderer.invoke('start-timer');
    },

    stopTimerOnMain: () => {
        return ipcRenderer.invoke('stop-timer');
    },

    // Functions related to capturing camera snaps of user
    registerListenerForCameraSnapFromMain: (callback) => {
        ipcRenderer.on('camera-shot', callback);

        return () => {
            ipcRenderer.removeListener('camera-shot', callback);
        };
    },

    // Functions related to capturing desktop screen (desktopCapturer)
    registerListenerForScreenSnapFromMain: (callback) => {
        const fn = (_event, result) => {
            callback(result);
        };
        ipcRenderer.on('screen-shot', fn);

        return () => {
            ipcRenderer.removeListener('screen-shot', fn);
        };
    },

    captureScreenSnapshot: () => {
        return ipcRenderer.invoke('capture-screen-now');
    },

    storeCameraSnapImageOnDisk: (data) => {
        return ipcRenderer.invoke('store-camera-snap-image-on-disk', data);
    },

    // Functions related to camera storage folder configuration
    getCameraFolder: () => {
        return ipcRenderer.invoke('get-camera-folder');
    },

    selectCameraFolder: () => {
        return ipcRenderer.invoke('select-camera-folder');
    },

    // Function related to selecting a file via dialog and getting its path
    selectFile: () => {
        return ipcRenderer.invoke('select-file');
    },

    // Function to show dialog with checkbox and multiple buttons
    showCheckboxDialog: (options) => {
        return ipcRenderer.invoke('show-checkbox-dialog', options);
    },

    // Functions related to showing Contest Rules in a new Dialog
    showRules: () => {
        ipcRenderer.send("show-rules");
    },

    // Functions related to automatic lockdown full screen & safe exit
    enterFullScreen: () => {
        return ipcRenderer.invoke('enter-fullscreen');
    },

    requestExit: () => {
        return ipcRenderer.invoke('request-exit');
    },

    registerListenerForFullScreenChange: (callback) => {
        const fn = (_event, isFullScreen) => {
            callback(isFullScreen);
        };

        ipcRenderer.on('fullscreen-changed', fn);

        return () => {
            ipcRenderer.removeListener('fullscreen-changed', fn);
        };
    },

    getBackendUrl: () => {
        return ipcRenderer.invoke('get-backend-url');
    },

    saveLocalSession: (sessionData) => {
        return ipcRenderer.invoke('save-local-session', sessionData);
    },

    getLocalSessions: () => {
        return ipcRenderer.invoke('get-local-sessions');
    }
});


