// App.jsx
import { useEffect, useRef, useState } from 'react';
import './App.css';
import {
  checkBackendHealth,
  startExamSession,
  getLocalActiveSession,
  clearLocalActiveSession
} from './api';
import QuizView from './QuizView';

function App() {
  // Readiness state
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [backendStatus, setBackendStatus] = useState('connecting'); // 'connecting' | 'connected' | 'error'
  const [backendError, setBackendError] = useState('');
  const [timer, setTimer] = useState('');
  const [cameraSnapFolder, setCameraSnapFolder] = useState('');
  const [lastSavedSnap, setLastSavedSnap] = useState('');
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [screenSnapshotCount, setScreenSnapshotCount] = useState(0);
  const [lastSavedScreenSnap, setLastSavedScreenSnap] = useState('');
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [dialogFeedback, setDialogFeedback] = useState(null);
  const [isConsentConfirmed, setIsConsentConfirmed] = useState(false);

  // Exam session and Quiz state
  const [inQuiz, setInQuiz] = useState(false);
  const [examSession, setExamSession] = useState(() => getLocalActiveSession());
  const [isStartingQuiz, setIsStartingQuiz] = useState(false);

  // Persistent camera video ref & stream
  const persistentVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const hasStartedQuizRef = useRef(false);

  // 1. Initial Listeners and Local Session Check
  useEffect(() => {
    // Fetch default camera snap folder path
    if (window.athena?.getCameraFolder) {
      window.athena.getCameraFolder().then((folder) => {
        if (folder) setCameraSnapFolder(folder);
      }).catch((err) => {
        console.error("Failed to fetch camera folder:", err);
      });
    }

    // Register Listener for handling Timer Tick from Main
    let removeTimerTickListener = () => {};
    if (window.athena?.registerListenerForTimerTickFromMain) {
      removeTimerTickListener = window.athena.registerListenerForTimerTickFromMain(setTimer);
    }

    // Register Listener for handling Camera Snap Request from Main
    let removeCameraSnapListener = () => {};
    if (window.athena?.registerListenerForCameraSnapFromMain) {
      removeCameraSnapListener = window.athena.registerListenerForCameraSnapFromMain(() => {
        captureCameraSnapshot();
      });
    }

    // Register Listener for handling periodic Screen Captures from Main (desktopCapturer)
    let removeScreenSnapListener = () => {};
    if (window.athena?.registerListenerForScreenSnapFromMain) {
      removeScreenSnapListener = window.athena.registerListenerForScreenSnapFromMain((result) => {
        if (result?.filePath) {
          setLastSavedScreenSnap(result.filePath);
          setScreenSnapshotCount((c) => c + 1);
          console.log(`[Screen Capture] Received periodic screen capture: ${result.filePath}`);
        }
      });
    }

    // Register Listener for handling FullScreen status changes from Main
    let removeFullScreenListener = () => {};
    if (window.athena?.registerListenerForFullScreenChange) {
      removeFullScreenListener = window.athena.registerListenerForFullScreenChange(setFullScreen);
    }

    // Check backend connection
    pollBackendStatus();

    return () => {
      removeTimerTickListener();
      removeCameraSnapListener();
      removeScreenSnapListener();
      removeFullScreenListener();
    };
  }, []);

  // Poll backend health until online
  async function pollBackendStatus() {
    for (let attempts = 0; attempts < 15; attempts++) {
      try {
        await checkBackendHealth();
        setBackendStatus('connected');
        setBackendError('');
        return;
      } catch (err) {
        setBackendError(err.message || 'Connecting to backend...');
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    setBackendStatus('error');
  }

  // Attach camera stream to persistent and preview video elements
  useEffect(() => {
    if (cameraStream) {
      if (persistentVideoRef.current) {
        persistentVideoRef.current.srcObject = cameraStream;
        persistentVideoRef.current.play().catch(() => {});
      }
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = cameraStream;
      }
    }
  }, [cameraStream, inQuiz]);

  // Robust HTML5 Canvas Snapshot Capture
  async function captureCameraSnapshot() {
    const video = persistentVideoRef.current;
    if (!video || !video.srcObject) {
      console.warn('[Snapshot] No video stream attached to persistent video element');
      return null;
    }

    try {
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      if (window.athena?.storeCameraSnapImageOnDisk) {
        const result = await window.athena.storeCameraSnapImageOnDisk(dataUrl);
        if (result?.filePath) {
          setLastSavedSnap(result.filePath);
          setSnapshotCount((c) => c + 1);
          console.log(`[Snapshot] Saved capture: ${result.filePath}`);
          return result;
        }
      }
    } catch (err) {
      console.error('[Snapshot] Error capturing camera snapshot:', err);
    }
    return null;
  }

  // Desktop screen snapshot capture using desktopCapturer via Electron IPC
  async function triggerScreenCapture() {
    if (!window.athena?.captureScreenSnapshot) {
      console.warn('[Screen Capture] desktopCapturer is not available in window.athena');
      return null;
    }
    try {
      setIsCapturingScreen(true);
      const result = await window.athena.captureScreenSnapshot();
      if (result?.success && result.filePath) {
        setLastSavedScreenSnap(result.filePath);
        setScreenSnapshotCount((c) => c + 1);
        console.log(`[Screen Capture] Manual screen snapshot saved: ${result.filePath}`);
        return result;
      } else if (result?.error) {
        console.error('[Screen Capture] Capture error:', result.error);
        alert(`Screen capture error: ${result.error}`);
      }
    } catch (err) {
      console.error('[Screen Capture] Error capturing desktop screen:', err);
    } finally {
      setIsCapturingScreen(false);
    }
    return null;
  }

  // Get camera access & enter fullscreen
  async function getCameraAccess() {
    try {
      const videoData = await navigator.mediaDevices.getUserMedia({
        video: true
      });

      setCameraStream(videoData);
      if (persistentVideoRef.current) {
        persistentVideoRef.current.srcObject = videoData;
        persistentVideoRef.current.play().catch(() => {});
      }
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = videoData;
      }
      setCameraEnabled(true);

      // Automatically enter locked full screen mode upon granting camera access
      if (window.athena?.enterFullScreen) {
        await window.athena.enterFullScreen();
      } else {
        await enableFullScreen();
      }
      setFullScreen(true);
    } catch (err) {
      console.error('Cannot access camera:', err);
      alert('Cannot access Camera: ' + err.message);
    }
  }

  async function enableFullScreen() {
    try {
      if (window.athena?.enterFullScreen) {
        await window.athena.enterFullScreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
      setFullScreen(true);
    } catch (err) {
      console.error('Cannot access full screen:', err);
      alert('Cannot access full screen');
    }
  }

  // Function to initialize/resume exam session and transition to Quiz
  async function handleStartQuiz(forceNew = false) {
    if (isStartingQuiz) return;
    setIsStartingQuiz(true);

    try {
      // 1. Start or resume exam session (locally & on backend)
      const startRes = await startExamSession('student-101', 'Vaibhav', forceNew);
      const activeSession = startRes.session || {
        sessionId: startRes.sessionId,
        userId: 'student-101',
        name: 'Vaibhav'
      };

      setExamSession(activeSession);

      // 2. Start timer and camera capture intervals on Electron main process
      if (window.athena?.startTimerOnMain) {
        await window.athena.startTimerOnMain();
      }

      // 3. Transition to Quiz view
      setInQuiz(true);

      // 4. Capture initial camera and screen snapshots immediately
      setTimeout(() => {
        captureCameraSnapshot();
        triggerScreenCapture();
      }, 600);
    } catch (err) {
      console.error('Failed to start exam session:', err);
      alert(`Could not start exam session: ${err.message}`);
    } finally {
      setIsStartingQuiz(false);
    }
  }

  // All checks satisfied condition
  const allChecksPassed = (backendStatus === 'connected' || backendStatus === 'connecting') && cameraEnabled && fullScreen;

  // Auto-launch quiz once when all checks pass
  useEffect(() => {
    if (allChecksPassed && !inQuiz && !hasStartedQuizRef.current) {
      hasStartedQuizRef.current = true;
      const timerId = setTimeout(() => {
        handleStartQuiz(false);
      }, 1000);

      return () => clearTimeout(timerId);
    }
  }, [allChecksPassed, inQuiz]);

  // Restart assessment afresh
  function handleStartNewAssessment() {
    clearLocalActiveSession();
    hasStartedQuizRef.current = false;
    setInQuiz(false);
    setExamSession(null);
    setSnapshotCount(0);
    setScreenSnapshotCount(0);
    setLastSavedScreenSnap('');
    setTimeout(() => {
      handleStartQuiz(true);
    }, 200);
  }

  // Dialog API helpers
  function onConsentApproved() {
    setIsConsentConfirmed(true);
    setDialogFeedback({
      type: 'success',
      title: 'Consent Verified',
      message: 'Webcam snapshot monitoring consent has been recorded.'
    });
  }

  function onConsentMissing() {
    setIsConsentConfirmed(false);
    setDialogFeedback({
      type: 'warning',
      title: 'Consent Incomplete',
      message: 'Please confirm the consent checkbox to approve proctoring.'
    });
  }

  function onReviewRulesClicked() {
    if (window.athena?.showRules) {
      window.athena.showRules();
    }
  }

  async function handleTriggerCheckboxDialog() {
    try {
      if (!window.athena?.showCheckboxDialog) return;

      const result = await window.athena.showCheckboxDialog({
        title: 'Athena Examination Verification',
        message: 'Exam Proctoring & Security Consent',
        detail: 'Periodic camera snapshots will be captured and stored in your selected folder during this test.\n\nPlease verify your consent and choose an action below:',
        buttons: ['Confirm & Proceed', 'Review Rules', 'Cancel Session'],
        checkboxLabel: 'I acknowledge and consent to webcam snapshot monitoring',
        checkboxChecked: isConsentConfirmed
      });

      if (result.response === 0) {
        if (result.checkboxChecked) {
          onConsentApproved();
        } else {
          onConsentMissing();
        }
      } else if (result.response === 1) {
        onReviewRulesClicked();
      }
    } catch (err) {
      console.error('Failed to show checkbox dialog:', err);
    }
  }

  async function handleSelectCameraFolder() {
    try {
      if (!window.athena?.selectCameraFolder) return;
      const res = await window.athena.selectCameraFolder();
      if (!res.canceled && res.folderPath) {
        setCameraSnapFolder(res.folderPath);
      }
    } catch (err) {
      console.error('Failed to select camera storage folder:', err);
    }
  }

  return (
    <>
      {/* Permanent, hidden video element that plays the stream continuously */}
      <video
        ref={persistentVideoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: 640,
          height: 480,
          opacity: 0,
          pointerEvents: 'none'
        }}
      />

      {/* If in Quiz mode, render QuizView */}
      {inQuiz && examSession ? (
        <QuizView
          session={examSession}
          timer={timer}
          cameraStream={cameraStream}
          snapshotCount={snapshotCount}
          lastSavedSnap={lastSavedSnap}
          screenSnapshotCount={screenSnapshotCount}
          lastSavedScreenSnap={lastSavedScreenSnap}
          onManualSnap={captureCameraSnapshot}
          onManualScreenSnap={triggerScreenCapture}
          onExitExam={() => window.athena?.requestExit?.()}
          onStartNewExam={handleStartNewAssessment}
        />
      ) : (
        /* System Readiness & Checks screen */
        <div className="page-container">
          {/* Header */}
          <div className="header-section">
            <h1>Hi Vaibhav!</h1>
            <p>Kindly verify the following system checks to start the test:</p>
          </div>

          {/* System Checks Summary Banner */}
          <div className="system-checks-banner">
            <div className={`check-badge ${backendStatus === 'connected' ? 'passed' : 'pending'}`}>
              <span className="check-icon">{backendStatus === 'connected' ? '✓' : '⟳'}</span>
              <span>Session Mode: Local & Server Sync</span>
            </div>
            <div className={`check-badge ${cameraEnabled ? 'passed' : 'pending'}`}>
              <span className="check-icon">{cameraEnabled ? '✓' : '○'}</span>
              <span>Webcam Proctoring {cameraEnabled ? 'Connected' : 'Pending'}</span>
            </div>
            <div className="check-badge passed">
              <span className="check-icon">✓</span>
              <span>Screen Capture (desktopCapturer) Ready</span>
            </div>
            <div className={`check-badge ${fullScreen ? 'passed' : 'pending'}`}>
              <span className="check-icon">{fullScreen ? '✓' : '○'}</span>
              <span>Fullscreen Lockdown {fullScreen ? 'Active' : 'Pending'}</span>
            </div>
          </div>

          {/* Main Readiness Card */}
          <div className="card-container">
            {/* Check 1: Backend Connection */}
            <div className="permission-item">
              <div className="permission-content">
                <div className="permission-title-row">
                  <h3>1. Local Exam Session & Backend</h3>
                  <span className={`status-pill ${backendStatus}`}>
                    {backendStatus === 'connected' && '🟢 Connected (Local & Server)'}
                    {backendStatus === 'connecting' && '🟡 Connecting...'}
                    {backendStatus === 'error' && '🟡 Local Mode (Offline)'}
                  </span>
                </div>
                <p>
                  Sessions are stored locally on your machine and synchronized with the backend.
                  {examSession && ` Active local session: ${examSession.sessionId}`}
                </p>
                {backendError && backendStatus === 'error' && (
                  <p className="subtext-hint" style={{ color: '#b45309' }}>{backendError}</p>
                )}
                {backendStatus !== 'connected' && (
                  <button className="btn btn-secondary" onClick={pollBackendStatus}>
                    Retry Server Sync
                  </button>
                )}
              </div>
            </div>

            <div className="divider"></div>

            {/* Check 2: Camera */}
            <div className="permission-item">
              <div className="permission-content">
                <div className="permission-title-row">
                  <h3>2. Configure Heimdall Proctoring (Camera)</h3>
                  <span className={`status-pill ${cameraEnabled ? 'connected' : 'pending'}`}>
                    {cameraEnabled ? '🟢 Camera Connected' : '⚪ Required'}
                  </span>
                </div>
                <p>Kindly configure camera to attempt quiz and enable automated camera snapshots every 5 seconds.</p>
                <div className="action-row">
                  <button
                    className="btn btn-black"
                    disabled={cameraEnabled}
                    onClick={getCameraAccess}
                  >
                    {cameraEnabled ? 'Camera Connected' : 'Connect with Heimdall'}
                  </button>

                  {/* Video Feed Preview */}
                  <video
                    ref={previewVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="video-preview"
                    style={{ width: cameraEnabled ? 160 : 0, height: cameraEnabled ? 100 : 0 }}
                  />
                </div>
              </div>
            </div>

            <div className="divider"></div>

            {/* Check 3: Fullscreen */}
            <div className="permission-item">
              <div className="permission-content">
                <div className="permission-title-row">
                  <h3>3. Switch to full screen</h3>
                  <span className={`status-pill ${fullScreen ? 'connected' : 'pending'}`}>
                    {fullScreen ? '🟢 Full Screen Active' : '⚪ Required'}
                  </span>
                </div>
                <p>Full screen mode is mandatory during the assessment to maintain exam integrity.</p>
                <button
                  className="btn btn-primary"
                  disabled={fullScreen}
                  onClick={enableFullScreen}
                >
                  {fullScreen ? 'Full Screen Enabled' : 'Give Full Screen Permissions'}
                </button>
              </div>
            </div>
          </div>

          {/* Auto-start notice or Ready Banner */}
          {allChecksPassed && (
            <div className="auto-start-banner">
              <div className="banner-content">
                <span className="party-icon">🎉</span>
                <div>
                  <h4>All system readiness checks passed!</h4>
                  <p>Loading assessment quiz now...</p>
                </div>
              </div>
              <button
                className="btn btn-black"
                onClick={() => handleStartQuiz(false)}
                disabled={isStartingQuiz}
              >
                {isStartingQuiz ? 'Loading...' : 'Go To Test Now →'}
              </button>
            </div>
          )}

          {/* Proctored Storage & Dialog Settings Card */}
          <div className="card-container config-card">
            <div className="header-section" style={{ textAlign: 'left', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                Snapshot Storage & Security Settings
              </h2>
              <p style={{ fontSize: 14, color: '#64748b' }}>
                Manage where camera shots are stored and test snapshot capture
              </p>
            </div>

            {/* Storage folder and manual test capture */}
            <div className="config-item">
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Proctoring Storage Folder (Camera & Screen Capture)</h3>
              <p className="subtext-hint">
                Automatic webcam captures and screen captures (via <code>desktopCapturer</code>) will be stored in this directory every 5s during your test.
              </p>
              <div className="controls-row">
                <button className="btn btn-black" onClick={handleSelectCameraFolder}>
                  📁 Choose Storage Folder
                </button>
                <div className="path-badge highlight">
                  <span className="badge-icon">📍</span>
                  <span>{cameraSnapFolder || 'Default: app/user-camera-snap'}</span>
                </div>
                <button
                  className="btn btn-outline"
                  disabled={!cameraEnabled}
                  onClick={captureCameraSnapshot}
                  title="Test webcam snapshot right now"
                >
                  📸 Test Camera
                </button>
                <button
                  className="btn btn-outline"
                  disabled={isCapturingScreen}
                  onClick={triggerScreenCapture}
                  title="Test screen capture via desktopCapturer right now"
                >
                  {isCapturingScreen ? '⏳ Capturing...' : '🖥️ Test Screen Capture'}
                </button>
              </div>
              {lastSavedSnap && (
                <div className="path-badge" style={{ marginTop: '8px', color: '#166534', background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                  <span className="badge-icon">📸</span>
                  <span>Saved Cam #{snapshotCount}: {lastSavedSnap}</span>
                </div>
              )}
              {lastSavedScreenSnap && (
                <div className="path-badge" style={{ marginTop: '6px', color: '#1e40af', background: '#eff6ff', borderColor: '#bfdbfe' }}>
                  <span className="badge-icon">🖥️</span>
                  <span>Saved Screen #{screenSnapshotCount}: {lastSavedScreenSnap}</span>
                </div>
              )}
            </div>

            <div className="divider"></div>

            {/* Dialog consent */}
            <div className="config-item">
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Security Consent & Exam Rules</h3>
              <div className="controls-row">
                <button className="btn btn-accent" onClick={handleTriggerCheckboxDialog}>
                  💬 Open Security Consent Dialog
                </button>
                <button className="btn btn-outline" onClick={onReviewRulesClicked}>
                  Show Exam Rules
                </button>
              </div>

              {dialogFeedback && (
                <div className={`status-feedback-box ${dialogFeedback.type}`}>
                  <div className="feedback-title">{dialogFeedback.title}</div>
                  <div className="feedback-desc">{dialogFeedback.message}</div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Footer */}
          <div className="card-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                {allChecksPassed ? 'Ready to attempt quiz!' : 'Complete all checks to start'}
              </h3>
              <p className="subtext-hint">
                {allChecksPassed
                  ? 'All checks verified. Starting quiz...'
                  : 'Please connect camera and allow full screen to begin.'}
              </p>
            </div>
            <div className="bottom-actions">
              {fullScreen && (
                <button
                  className="btn btn-outline"
                  onClick={() => window.athena?.requestExit()}
                  title="Exit Exam"
                >
                  Exit Exam (Cmd + Q)
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!allChecksPassed || isStartingQuiz}
                onClick={() => handleStartQuiz(false)}
              >
                {isStartingQuiz ? 'Starting...' : 'Go To Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;