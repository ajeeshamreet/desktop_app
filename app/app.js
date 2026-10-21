import { app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen } from "electron";
import path from "path";
import fs from "fs";
import { fork } from "child_process";

let electronWindow = null;
let startTimestamp = null;
let timerInterval = null;
let cameraInterval = null;
let screenInterval = null;

// Dynamic directory to store camera snapshots and screen captures
let cameraSnapDir = path.join(import.meta.dirname, "user-camera-snap");
let localSessionsPath = path.join(import.meta.dirname, "local-sessions.json");

function getCameraSubDir() {
    const dir = path.join(cameraSnapDir, "camera");
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            // Ignore error
        }
    }
    return dir;
}

function getScreenSubDir() {
    const dir = path.join(cameraSnapDir, "screen");
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {
            // Ignore error
        }
    }
    return dir;
}

function initStoragePaths() {
    if (app.isPackaged) {
        const userData = app.getPath("userData");
        cameraSnapDir = path.join(userData, "user-camera-snap");
        localSessionsPath = path.join(userData, "local-sessions.json");
        if (!fs.existsSync(localSessionsPath)) {
            const bundledSessions = path.join(import.meta.dirname, "local-sessions.json");
            if (fs.existsSync(bundledSessions)) {
                try {
                    fs.copyFileSync(bundledSessions, localSessionsPath);
                } catch {
                    // Ignore copy error
                }
            }
        }
    }
    if (!fs.existsSync(cameraSnapDir)) {
        try {
            fs.mkdirSync(cameraSnapDir, { recursive: true });
        } catch {
            // Ignore error
        }
    }
    getCameraSubDir();
    getScreenSubDir();
}

// Capture desktop screen using Electron's desktopCapturer API
async function captureDesktopScreen() {
    try {
        if (!fs.existsSync(cameraSnapDir)) {
            fs.mkdirSync(cameraSnapDir, { recursive: true });
        }

        // Determine screen resolution bounds from primary display
        let thumbnailSize = { width: 1920, height: 1080 };
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            if (primaryDisplay?.size) {
                const scale = primaryDisplay.scaleFactor || 1;
                thumbnailSize = {
                    width: Math.round(primaryDisplay.size.width * scale),
                    height: Math.round(primaryDisplay.size.height * scale)
                };
            }
        } catch (displayErr) {
            console.warn('[Screen Capture] Could not retrieve display dimensions, using standard fallback:', displayErr);
        }

        // Capture screen sources via desktopCapturer
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize
        });

        if (!sources || sources.length === 0) {
            console.warn('[Screen Capture] No screen sources returned by desktopCapturer');
            return { success: false, error: 'No screen sources found' };
        }

        // Choose primary screen or first available screen source
        const primarySource = sources.find(s =>
            s.id.startsWith('screen:0') ||
            s.name.toLowerCase().includes('entire') ||
            s.name.toLowerCase().includes('screen 1')
        ) || sources[0];

        if (!primarySource || primarySource.thumbnail.isEmpty()) {
            console.warn('[Screen Capture] Screen thumbnail is empty');
            return { success: false, error: 'Screen capture returned empty image' };
        }

        // Convert NativeImage thumbnail to JPEG buffer and save in screen subfolder
        const buffer = primarySource.thumbnail.toJPEG(85);
        const fileName = `screen-${Date.now()}.jpg`;
        const screenDir = getScreenSubDir();
        const filePath = path.join(screenDir, fileName);

        fs.writeFileSync(filePath, buffer);
        console.log(`[Screen Capture] Saved screen capture to disk: ${filePath} (${buffer.length} bytes)`);

        return {
            success: true,
            filePath,
            fileName,
            size: buffer.length,
            timestamp: Date.now()
        };
    } catch (err) {
        console.error('[Screen Capture] Failed to capture screen:', err);
        return { success: false, error: err.message };
    }
}

const DEV_URL = 'http://localhost:5173';
let viteDevServer = null;

const BACKEND_URL = 'http://localhost:3000';
let backendProcess = null;

async function ensureBackendRunning() {
    try {
        const res = await fetch(BACKEND_URL);
        if (res.ok || res.status === 200) {
            console.log('Exam backend is already running on', BACKEND_URL);
            return;
        }
    } catch {
        // Backend not currently responding
    }

    try {
        let backendPath = path.join(import.meta.dirname, '../backend/server.js');
        if (app.isPackaged) {
            const unpackedPath = backendPath.replace('app.asar', 'app.asar.unpacked');
            if (fs.existsSync(unpackedPath)) {
                backendPath = unpackedPath;
            }
        }

        backendProcess = fork(backendPath, [], {
            cwd: path.dirname(backendPath),
            env: {
                ...process.env,
                USER_DATA_PATH: app.isPackaged ? app.getPath('userData') : path.join(import.meta.dirname, '../backend/data')
            },
            stdio: 'inherit'
        });
        console.log('Auto-started exam backend server (PID:', backendProcess.pid, ')');

        // Poll briefly until ready
        for (let i = 0; i < 25; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            try {
                const res = await fetch(BACKEND_URL);
                if (res.ok || res.status === 200) {
                    console.log('Exam backend is ready and responding.');
                    break;
                }
            } catch {
                // keep waiting
            }
        }
    } catch (err) {
        console.error('Failed to auto-start exam backend server:', err);
    }
}

async function ensureServerRunning() {
    try {
        const res = await fetch(DEV_URL);
        if (res.ok || res.status === 200 || res.status === 304) {
            return;
        }
    } catch {
        // Dev server not currently responding
    }

    try {
        const { createServer } = await import('vite');
        viteDevServer = await createServer({
            server: { port: 5173 }
        });
        await viteDevServer.listen();
    } catch (err) {
        console.warn('Could not auto-start embedded Vite dev server:', err);
    }
}

let isLockedFullScreen = false;
let isQuitting = false;
let isShowingExitWarning = false;

async function handleExitConfirmation() {
    if (isQuitting || isShowingExitWarning) return;
    isShowingExitWarning = true;

    const choice = await dialog.showMessageBox(electronWindow, {
        type: 'warning',
        buttons: ['Stay in Exam', 'Exit Exam'],
        defaultId: 0,
        cancelId: 0,
        title: 'Athena Exam Exit Warning',
        message: 'Are you sure you want to exit Athena Exam?',
        detail: 'Exiting now will terminate your exam session and submit any incomplete progress. Minimizing or leaving is restricted during the test.'
    });

    isShowingExitWarning = false;

    if (choice.response === 1) {
        isQuitting = true;
        if (timerInterval) clearInterval(timerInterval);
        if (cameraInterval) clearInterval(cameraInterval);
        if (screenInterval) clearInterval(screenInterval);
        if (backendProcess) {
            try {
                backendProcess.kill();
                backendProcess = null;
            } catch {
                // Ignore cleanup error
            }
        }
        if (viteDevServer) {
            try {
                await viteDevServer.close();
            } catch {
                // Ignore cleanup error
            }
        }
        app.quit();
    }
}

async function createWindow() {
    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,
        fullscreenable: true,
        webPreferences: {
            devTools: true,
            preload: path.join(import.meta.dirname, 'preload.js')
        }
    });

    // Prevent minimizing window by gesture or shortcut when locked
    electronWindow.on('minimize', (event) => {
        if (isLockedFullScreen) {
            event.preventDefault();
            electronWindow.restore();
            electronWindow.focus();
        }
    });

    // Prevent leaving fullscreen / gesture swipes when locked
    electronWindow.on('leave-full-screen', () => {
        if (isLockedFullScreen) {
            setTimeout(() => {
                if (electronWindow && !electronWindow.isDestroyed() && isLockedFullScreen) {
                    electronWindow.setFullScreen(true);
                    electronWindow.setKiosk(true);
                }
            }, 50);
        }
    });

    electronWindow.on('leave-html-full-screen', () => {
        if (isLockedFullScreen) {
            setTimeout(() => {
                if (electronWindow && !electronWindow.isDestroyed() && isLockedFullScreen) {
                    electronWindow.setFullScreen(true);
                    electronWindow.setKiosk(true);
                }
            }, 50);
        }
    });

    // Intercept Command + Q and Escape keys on webContents
    electronWindow.webContents.on('before-input-event', (event, input) => {
        // Prevent Escape from exiting fullscreen when locked
        if (isLockedFullScreen && input.key === 'Escape') {
            event.preventDefault();
        }

        // Command+Q (macOS) or Ctrl+Q triggers exit confirmation warning
        if ((input.meta || input.control) && input.key.toLowerCase() === 'q') {
            event.preventDefault();
            handleExitConfirmation();
        }
    });

    // Intercept window close event
    electronWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            handleExitConfirmation();
        }
    });

    initStoragePaths();
    await ensureBackendRunning();

    if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
        await ensureServerRunning();
        try {
            await electronWindow.loadURL(DEV_URL);
            return;
        } catch (err) {
            console.warn(`Could not connect to ${DEV_URL} (${err.message}). Falling back to dist...`);
        }
    }

    const distPath = path.join(import.meta.dirname, '../dist/index.html');
    if (fs.existsSync(distPath)) {
        await electronWindow.loadFile(distPath);
    } else {
        console.error('dist/index.html not found! Make sure to run vite build.');
    }
}

ipcMain.handle('start-timer', () => {
    if (timerInterval) clearInterval(timerInterval);
    if (cameraInterval) clearInterval(cameraInterval);
    if (screenInterval) clearInterval(screenInterval);

    startTimestamp = Date.now();

    // Send Timer Tick every 1s
    timerInterval = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('timer', Math.floor((Date.now() - startTimestamp) / 1000));
        }
    }, 1000);

    // Capture user's camera snap every 1s
    cameraInterval = setInterval(() => {
        if (electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('camera-shot');
        }
    }, 1000);

    // Capture screen every 1s using desktopCapturer
    screenInterval = setInterval(async () => {
        const result = await captureDesktopScreen();
        if (result.success && electronWindow && !electronWindow.isDestroyed()) {
            electronWindow.webContents.send('screen-shot', result);
        }
    }, 1000);

    return { started: true };
});

ipcMain.handle('stop-timer', () => {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (cameraInterval) {
        clearInterval(cameraInterval);
        cameraInterval = null;
    }
    if (screenInterval) {
        clearInterval(screenInterval);
        screenInterval = null;
    }
    return { stopped: true };
});

// Manual/On-demand screen capture using desktopCapturer
ipcMain.handle('capture-screen-now', async () => {
    return await captureDesktopScreen();
});

// Get current camera snap directory
ipcMain.handle('get-camera-folder', () => {
    return cameraSnapDir;
});

// Select folder to store camera shots using dialog API
ipcMain.handle('select-camera-folder', async () => {
    const result = await dialog.showOpenDialog(electronWindow, {
        title: 'Select Folder to Store Camera Shots',
        defaultPath: cameraSnapDir,
        properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        cameraSnapDir = result.filePaths[0];
        if (!fs.existsSync(cameraSnapDir)) {
            fs.mkdirSync(cameraSnapDir, { recursive: true });
        }
        getCameraSubDir();
        getScreenSubDir();
        return { canceled: false, folderPath: cameraSnapDir };
    }

    return { canceled: true, folderPath: cameraSnapDir };
});

// Select a file using dialog box and get its path
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(electronWindow, {
        title: 'Select File',
        properties: ['openFile']
    });

    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return { canceled: false, filePath: result.filePaths[0] };
    }

    return { canceled: true, filePath: null };
});

// Show dialog with checkbox and multiple buttons
ipcMain.handle('show-checkbox-dialog', async (_event, customOptions = {}) => {
    const buttons = customOptions.buttons || ['Accept & Proceed', 'View Rules', 'Cancel'];
    const options = {
        type: 'question',
        title: customOptions.title || 'Security Consent & Confirmation',
        message: customOptions.message || 'Athena Exam Security Check',
        detail: customOptions.detail ||
            'Periodic camera snapshots will be captured during this test session.\nPlease verify your consent below.',
        buttons: buttons,
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: customOptions.checkboxLabel || 'I agree to camera snapshot monitoring during this session',
        checkboxChecked: customOptions.checkboxChecked ?? false
    };

    const result = await dialog.showMessageBox(electronWindow, options);
    return {
        response: result.response,
        checkboxChecked: result.checkboxChecked,
        buttonName: buttons[result.response]
    };
});

// Local sessions file path in app or user-data directory (initialized in initStoragePaths)

// Store captured camera snap image to disk in camera subfolder under main folder
ipcMain.handle('store-camera-snap-image-on-disk', (_event, data) => {
    try {
        const camDir = getCameraSubDir();
        const fileName = `snap-${Date.now()}.jpg`;
        const filePath = path.join(camDir, fileName);

        let buffer;
        if (typeof data === 'string' && data.startsWith('data:image')) {
            const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(base64Data, 'base64');
        } else if (Buffer.isBuffer(data)) {
            buffer = data;
        } else {
            buffer = Buffer.from(data);
        }

        fs.writeFileSync(filePath, buffer);
        console.log(`[Camera Snap] Saved snapshot to disk: ${filePath} (${buffer.length} bytes)`);
        return { success: true, filePath, fileName, size: buffer.length };
    } catch (err) {
        console.error('[Camera Snap] Failed to save snapshot:', err);
        return { success: false, error: err.message };
    }
});

// Save session data locally in Electron app directory
ipcMain.handle('save-local-session', (_event, sessionData) => {
    try {
        let sessions = [];
        if (fs.existsSync(localSessionsPath)) {
            try {
                sessions = JSON.parse(fs.readFileSync(localSessionsPath, 'utf-8'));
            } catch {
                sessions = [];
            }
        }
        const index = sessions.findIndex(s => s.sessionId === sessionData.sessionId);
        if (index >= 0) {
            sessions[index] = sessionData;
        } else {
            sessions.push(sessionData);
        }
        fs.writeFileSync(localSessionsPath, JSON.stringify(sessions, null, 2));
        return { success: true, localSessionsPath };
    } catch (err) {
        console.error('Failed to save local session:', err);
        return { success: false, error: err.message };
    }
});

// Retrieve local sessions from Electron app directory
ipcMain.handle('get-local-sessions', () => {
    try {
        if (fs.existsSync(localSessionsPath)) {
            return JSON.parse(fs.readFileSync(localSessionsPath, 'utf-8'));
        }
        return [];
    } catch {
        return [];
    }
});

ipcMain.on("show-rules", () => {
    dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Athena Exam Rules",
        message: "Exam Rules",
        detail:
            "1. Stay on the exam screen.\n" +
            "2. Camera must remain enabled.\n" +
            "3. Do not leave the exam.\n" +
            "4. Do not use external assistance.\n" +
            "5. Click Exit Exam when finished."
    });
});

// Enter locked full screen mode (kiosk + non-minimizable)
ipcMain.handle('enter-fullscreen', () => {
    isLockedFullScreen = true;
    if (electronWindow && !electronWindow.isDestroyed()) {
        electronWindow.setMinimizable(false);
        electronWindow.setFullScreen(true);
        electronWindow.setKiosk(true);
        electronWindow.webContents.send('fullscreen-changed', true);
    }
    return { success: true, isLockedFullScreen: true };
});

// Request exit manually from renderer
ipcMain.handle('request-exit', async () => {
    await handleExitConfirmation();
    return { success: true };
});

// Provide backend URL to renderer
ipcMain.handle('get-backend-url', () => {
    return BACKEND_URL;
});

app.on('before-quit', (event) => {
    if (!isQuitting) {
        event.preventDefault();
        handleExitConfirmation();
    }
});

app.on('will-quit', () => {
    if (timerInterval) clearInterval(timerInterval);
    if (cameraInterval) clearInterval(cameraInterval);
    if (screenInterval) clearInterval(screenInterval);
    if (backendProcess) {
        try {
            backendProcess.kill();
            backendProcess = null;
        } catch {
            // Ignore error
        }
    }
});

app.whenReady().then(createWindow);