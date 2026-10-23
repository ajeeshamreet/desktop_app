import { useEffect, useRef, useState } from 'react';
import './App.css';
import {
  checkBackendHealth,
  startExamSession,
  checkStudentStatus,
  getLocalActiveSession,
  clearLocalActiveSession
} from './api';
import QuizView from './QuizView';

function CheckIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CircleIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function SyncIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

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

  // Candidate Identity, Verification & Countdown state
  const [candidateName, setCandidateName] = useState('');
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [isCandidateRegistered, setIsCandidateRegistered] = useState(false);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [alreadySubmittedWarning, setAlreadySubmittedWarning] = useState(null);
  const [countdown, setCountdown] = useState(null);

  // Exam session and Quiz state
  const [inQuiz, setInQuiz] = useState(false);
  const [examSession, setExamSession] = useState(() => getLocalActiveSession());
  const [isStartingQuiz, setIsStartingQuiz] = useState(false);

  // Persistent camera video ref & stream
  const persistentVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const hasStartedQuizRef = useRef(false);

  // Restore candidate name and ID from existing in-progress session if any
  useEffect(() => {
    const existing = getLocalActiveSession();
    if (existing && existing.status === 'in-progress') {
      if (existing.name) setCandidateName(existing.name);
      if (existing.userId) setEnrollmentNo(existing.userId);
      setIsCandidateRegistered(true);
    }
  }, []);

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
      removeFullScreenListener = window.athena.registerListenerForFullScreenChange((isFull) => {
        setFullScreen(isFull);
      });
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

  // Get camera access (Heimdall)
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

  // Candidate verification check
  async function handleVerifyCandidate(e) {
    if (e) e.preventDefault();
    const name = candidateName.trim();
    const enrollment = enrollmentNo.trim();

    if (!name) {
      setVerificationError('Please enter your full name.');
      return;
    }
    if (!enrollment) {
      setVerificationError('Please enter your enrollment number.');
      return;
    }

    setVerificationError('');
    setIsVerifying(true);
    setAlreadySubmittedWarning(null);

    try {
      const status = await checkStudentStatus(enrollment, name);
      if (status.alreadySubmitted) {
        // Warning: student has already submitted / finished the test
        setAlreadySubmittedWarning({
          message: 'Student has already finished the test.',
          studentName: status.session?.name || name,
          enrollmentNo: status.session?.userId || enrollment,
          submittedAt: status.session?.submittedAt,
          attempted: status.session?.attempted,
          correct: status.session?.correct,
          wrong: status.session?.wrong,
          sessionId: status.session?.sessionId
        });
        setIsVerifying(false);
        return;
      }

      // First time attempt: begin 15-second countdown!
      setIsCandidateRegistered(true);
      setCountdown(15);
    } catch (err) {
      console.error('Candidate verification error:', err);
      setVerificationError('Verification failed: ' + (err.message || 'Please try again'));
    } finally {
      setIsVerifying(false);
    }
  }

  // 15-second countdown effect for first-time attempts
  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timerId = setTimeout(() => {
        setCountdown((c) => (c !== null ? c - 1 : null));
      }, 1000);
      return () => clearTimeout(timerId);
    } else if (countdown === 0) {
      setCountdown(null);
      setShowRegistrationModal(false);
      handleStartQuiz(false, enrollmentNo.trim(), candidateName.trim());
    }
  }, [countdown, enrollmentNo, candidateName]);

  function handleSkipCountdown() {
    setCountdown(null);
    setShowRegistrationModal(false);
    handleStartQuiz(false, enrollmentNo.trim(), candidateName.trim());
  }

  function handleResetVerification() {
    setAlreadySubmittedWarning(null);
    setVerificationError('');
    setIsCandidateRegistered(false);
    setCountdown(null);
  }

  // Function to initialize/resume exam session and transition to Quiz
  async function handleStartQuiz(forceNew = false, customEnrollment = null, customName = null) {
    if (isStartingQuiz) return;
    setIsStartingQuiz(true);

    const activeEnrollment = customEnrollment || enrollmentNo.trim() || 'student-101';
    const activeName = customName || candidateName.trim() || 'Candidate';

    try {
      // 1. Start or resume exam session (locally & on backend)
      const startRes = await startExamSession(activeEnrollment, activeName, forceNew);
      const activeSession = startRes.session || {
        sessionId: startRes.sessionId,
        userId: activeEnrollment,
        name: activeName
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
      if (err.alreadySubmitted) {
        setAlreadySubmittedWarning({
          message: 'Student has already finished the test.',
          studentName: err.session?.name || activeName,
          enrollmentNo: err.session?.userId || activeEnrollment,
          submittedAt: err.session?.submittedAt,
          sessionId: err.session?.sessionId
        });
        setShowRegistrationModal(true);
      } else {
        alert(`Could not start exam session: ${err.message}`);
      }
    } finally {
      setIsStartingQuiz(false);
    }
  }

  // Both camera (Heimdall) and fullscreen must be active
  const bothReady = cameraEnabled && fullScreen;
  const allChecksPassed = (backendStatus === 'connected' || backendStatus === 'connecting') && bothReady;

  // Restart assessment afresh
  function handleStartNewAssessment() {
    clearLocalActiveSession();
    hasStartedQuizRef.current = false;
    setInQuiz(false);
    setExamSession(null);
    setCandidateName('');
    setEnrollmentNo('');
    setIsCandidateRegistered(false);
    setAlreadySubmittedWarning(null);
    setCountdown(null);
    setShowRegistrationModal(true);
    setSnapshotCount(0);
    setScreenSnapshotCount(0);
    setLastSavedScreenSnap('');
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
            <h1>{candidateName.trim() ? `Hi ${candidateName.trim()}!` : 'Athena Examination Portal'}</h1>
          </div>

          {backendError && backendStatus === 'error' && (
            <div className="card-container" style={{ marginBottom: 20, borderColor: '#fecaca', background: '#fef2f2' }}>
              <div style={{ color: '#b91c1c', fontWeight: 600, marginBottom: 6 }}>Server Connection Issue</div>
              <p style={{ color: '#7f1d1d', fontSize: 14 }}>{backendError}</p>
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={pollBackendStatus}>
                Retry Connection
              </button>
            </div>
          )}

          {/* Main Readiness Card */}
          <div className="card-container">
            {/* Check 1: Camera */}
            <div className="permission-item">
              <div className="permission-content">
                <div className="permission-title-row">
                  <h3>1. Configure Camera</h3>
                  <span className={`status-pill ${cameraEnabled ? 'connected' : 'pending'}`}>
                    {cameraEnabled ? 'Camera Connected' : 'Required'}
                  </span>
                </div>
                <p>Configure camera to attempt quiz and enable automated proctoring.</p>
                <div className="action-row">
                  <button
                    className="btn btn-black"
                    disabled={cameraEnabled}
                    onClick={getCameraAccess}
                  >
                    {cameraEnabled ? 'Camera Connected' : 'Connect Camera'}
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

            {/* Check 2: Fullscreen */}
            <div className="permission-item">
              <div className="permission-content">
                <div className="permission-title-row">
                  <h3>2. Switch to full screen</h3>
                  <span className={`status-pill ${fullScreen ? 'connected' : 'pending'}`}>
                    {fullScreen ? 'Full Screen Active' : 'Required'}
                  </span>
                </div>
                <p>Full screen mode is mandatory. Both camera and full screen must be active to start the test.</p>
                <div className="action-row">
                  <button
                    className="btn btn-primary"
                    disabled={fullScreen}
                    onClick={enableFullScreen}
                  >
                    {fullScreen ? 'Full Screen Enabled' : 'Give Full Screen Permissions'}
                  </button>
                  {bothReady && !isCandidateRegistered && (
                    <button
                      className="btn btn-accent"
                      onClick={() => setShowRegistrationModal(true)}
                    >
                      Enter Candidate Details
                    </button>
                  )}
                  {bothReady && isCandidateRegistered && (
                    <button
                      className="btn btn-outline"
                      onClick={() => setShowRegistrationModal(true)}
                    >
                      Candidate: {candidateName} ({enrollmentNo})
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Action Footer */}
          <div className="card-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                {bothReady && isCandidateRegistered
                  ? 'Ready to attempt quiz!'
                  : bothReady
                  ? 'Ready to Start Test'
                  : 'Complete all checks to start'}
              </h3>
              <p className="subtext-hint">
                {bothReady && isCandidateRegistered
                  ? `All checks verified for ${candidateName} (${enrollmentNo}).`
                  : bothReady
                  ? 'Camera connected and fullscreen active. Click Start Test to proceed.'
                  : !cameraEnabled && !fullScreen
                  ? 'Please connect camera and allow full screen to begin.'
                  : !cameraEnabled
                  ? 'Please connect camera to proceed.'
                  : 'Please allow full screen to proceed.'}
              </p>
            </div>
            <div className="bottom-actions">
              {fullScreen && (
                <button
                  className="btn btn-outline"
                  onClick={() => window.athena?.requestExit ? window.athena.requestExit() : window.close()}
                  title="Exit Exam"
                >
                  Exit Exam (Cmd + Q)
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!bothReady || isStartingQuiz}
                onClick={() => {
                  if (!bothReady) return;
                  if (!isCandidateRegistered) {
                    setShowRegistrationModal(true);
                  } else {
                    handleStartQuiz(false, enrollmentNo, candidateName);
                  }
                }}
              >
                {isStartingQuiz
                  ? 'Starting...'
                  : isCandidateRegistered
                  ? 'Start Test'
                  : 'Start Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidate Modal: Only open when both Heimdall and Fullscreen are active */}
      {(!inQuiz && bothReady && (showRegistrationModal || alreadySubmittedWarning || countdown !== null)) && (
        <div className="candidate-overlay">
          <div className="candidate-modal-card">
            {/* 1. WARNING VIEW: Student Has Already Finished The Test */}
            {alreadySubmittedWarning ? (
              <div className="warning-container">
                <div className="warning-icon-badge">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="modal-badge" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>
                  Assessment Status: Already Finished
                </div>
                <h2 className="warning-title">Student Has Already Finished The Test</h2>
                <p className="warning-subtitle">
                  Our records show that an assessment has already been attempted and submitted under this enrollment number. Re-attempting the test is restricted.
                </p>

                <div className="warning-details-card">
                  <div className="warning-detail-row">
                    <span className="label">Candidate Name:</span>
                    <span className="value">{alreadySubmittedWarning.studentName}</span>
                  </div>
                  <div className="warning-detail-row">
                    <span className="label">Enrollment Number:</span>
                    <span className="value">{alreadySubmittedWarning.enrollmentNo}</span>
                  </div>
                  <div className="warning-detail-row">
                    <span className="label">Exam Status:</span>
                    <span className="warning-badge-pill">SUBMITTED</span>
                  </div>
                  {alreadySubmittedWarning.submittedAt && (
                    <div className="warning-detail-row">
                      <span className="label">Submitted At:</span>
                      <span className="value" style={{ fontSize: '12px' }}>
                        {new Date(alreadySubmittedWarning.submittedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {alreadySubmittedWarning.attempted !== undefined && (
                    <div className="warning-detail-row">
                      <span className="label">Questions Attempted:</span>
                      <span className="value">{alreadySubmittedWarning.attempted} questions</span>
                    </div>
                  )}
                </div>

                <div className="candidate-actions">
                  <button className="btn btn-primary btn-block" onClick={handleResetVerification}>
                    Enter Different Enrollment Number
                  </button>
                  <button
                    className="btn btn-outline btn-block"
                    onClick={() => window.athena?.requestExit ? window.athena.requestExit() : window.close()}
                  >
                    Exit Examination (Cmd + Q)
                  </button>
                </div>
              </div>
            ) : countdown !== null ? (
              /* 2. 5-SECOND COUNTDOWN VIEW FOR FIRST TIME ATTEMPTS */
              <div className="countdown-container">
                <div className="verified-pill">
                  <CheckIcon size={14} /> Credentials Verified Successfully
                </div>

                <div className="exam-rules-card">
                  <h4 className="exam-rules-title">Exam Rules & Guidelines</h4>
                  <ul className="exam-rules-list">
                    <li>Stay on the exam window at all times. Do not switch tabs or applications.</li>
                    <li>Webcam monitoring and screen captures are active throughout the exam.</li>
                    <li>Fullscreen mode is mandatory until final submission.</li>
                    <li>External assistance, phones, and secondary devices are strictly prohibited.</li>
                    <li>Review all your answers carefully before submitting the exam.</li>
                  </ul>
                </div>

                <div className="candidate-actions">
                  <button className="btn btn-green btn-block" onClick={handleSkipCountdown}>
                    Start Test / {countdown}s
                  </button>
                </div>
              </div>
            ) : (
              /* 3. CANDIDATE IDENTITY PROMPT (NAME & ENROLLMENT NUMBER) */
              <div>
                <div className="candidate-modal-header">
                  <h2>Candidate Identity Verification</h2>
                  <p>You are now in full screen mode. Please enter your name and enrollment number to verify and begin your test.</p>
                </div>

                <form className="candidate-form" onSubmit={handleVerifyCandidate}>
                  <div className="form-field">
                    <label className="form-label" htmlFor="cand-name-input">
                      <span>Candidate Full Name *</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="cand-name-input"
                        type="text"
                        className="form-input"
                        value={candidateName}
                        onChange={(e) => setCandidateName(e.target.value)}
                        autoFocus
                        disabled={isVerifying}
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label className="form-label" htmlFor="cand-enrollment-input">
                      <span>Enrollment Number / Student ID *</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        id="cand-enrollment-input"
                        type="text"
                        className="form-input"
                        value={enrollmentNo}
                        onChange={(e) => setEnrollmentNo(e.target.value)}
                        disabled={isVerifying}
                      />
                    </div>
                  </div>

                  {verificationError && (
                    <div className="form-error-alert">
                      <span>{verificationError}</span>
                    </div>
                  )}

                  <div className="candidate-actions">
                    <button
                      type="submit"
                      className="btn btn-primary btn-block"
                      disabled={isVerifying || !candidateName.trim() || !enrollmentNo.trim()}
                    >
                      {isVerifying ? 'Verifying Student Records...' : 'Verify & Begin Assessment →'}
                    </button>
                    {!fullScreen && (
                      <button
                        type="button"
                        className="btn btn-outline btn-block"
                        onClick={() => setShowRegistrationModal(false)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;