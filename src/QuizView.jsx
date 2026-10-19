// src/QuizView.jsx
import { useState, useEffect, useRef } from 'react';
import { fetchQuestions, submitAnswer, submitExam } from './api';

export default function QuizView({
  session,
  timer,
  cameraStream,
  snapshotCount = 0,
  lastSavedSnap = '',
  screenSnapshotCount = 0,
  lastSavedScreenSnap = '',
  onManualSnap,
  onManualScreenSnap,
  onExitExam,
  onStartNewExam
}) {
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState(() => {
    if (session?.answers && Array.isArray(session.answers)) {
      const existingAnswers = {};
      session.answers.forEach((ans) => {
        existingAnswers[ans.questionId] = ans.selectedAnswer;
      });
      return existingAnswers;
    }
    return {};
  });
  const [submittedQuestions, setSubmittedQuestions] = useState(() => {
    if (session?.answers && Array.isArray(session.answers)) {
      const existingSubmitted = {};
      session.answers.forEach((ans) => {
        existingSubmitted[ans.questionId] = true;
      });
      return existingSubmitted;
    }
    return {};
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [isExamCompleted, setIsExamCompleted] = useState(false);
  const [examResult, setExamResult] = useState(null);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const miniCamRef = useRef(null);

  // Attach cameraStream to mini preview video
  useEffect(() => {
    if (miniCamRef.current && cameraStream) {
      miniCamRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // Load questions from backend or local fallback on mount
  useEffect(() => {
    async function loadQuizData() {
      try {
        setLoading(true);
        setError('');
        const data = await fetchQuestions();
        if (!data || !Array.isArray(data) || data.length === 0) {
          throw new Error('No exam questions found.');
        }
        setQuestions(data);
      } catch (err) {
        console.error('Failed to load questions:', err);
        setError(err.message || 'Failed to connect to exam questions.');
      } finally {
        setLoading(false);
      }
    }

    loadQuizData();
  }, []);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;
  const answeredCount = Object.keys(answers).length;

  // Format seconds to mm:ss
  const formatTimer = (secondsNum) => {
    if (secondsNum === undefined || secondsNum === null || secondsNum === '') return '00:00';
    const total = parseInt(secondsNum, 10) || 0;
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle selecting an option
  const handleSelectOption = (optionIndex) => {
    if (isExamCompleted || !currentQuestion) return;
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIndex
    }));
  };

  // Submit single answer
  const handleSaveAnswer = async () => {
    if (!currentQuestion) return;
    const selectedAnswer = answers[currentQuestion.id];
    if (selectedAnswer === undefined) return;

    try {
      setSubmittingAction(true);
      await submitAnswer(session.sessionId, currentQuestion.id, selectedAnswer);
      setSubmittedQuestions((prev) => ({
        ...prev,
        [currentQuestion.id]: true
      }));

      // Auto advance to next question if not last
      if (currentIndex < totalQuestions - 1) {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err) {
      console.warn('Answer submit note:', err.message);
      setSubmittedQuestions((prev) => ({
        ...prev,
        [currentQuestion.id]: true
      }));
      if (currentIndex < totalQuestions - 1) {
        setCurrentIndex((i) => i + 1);
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  // Handle Final Exam Submission
  const handleFinalSubmit = async () => {
    try {
      setSubmittingAction(true);
      setShowConfirmSubmit(false);

      // Save pending answer if selected
      if (currentQuestion && answers[currentQuestion.id] !== undefined && !submittedQuestions[currentQuestion.id]) {
        try {
          await submitAnswer(session.sessionId, currentQuestion.id, answers[currentQuestion.id]);
        } catch {
          // ignore
        }
      }

      const res = await submitExam(session.sessionId);
      if (window.athena?.stopTimerOnMain) {
        await window.athena.stopTimerOnMain();
      }
      setExamResult(res.result || { attempted: answeredCount, correct: 0, wrong: 0 });
      setIsExamCompleted(true);
    } catch (err) {
      console.error('Final exam submission error:', err);
      alert(`Could not submit exam: ${err.message}`);
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="quiz-page-container">
        <div className="card-container loading-box">
          <div className="spinner"></div>
          <h2>Loading Assessment Questions...</h2>
          <p>Initializing local proctored assessment session</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-page-container">
        <div className="card-container error-box">
          <div className="error-icon">⚠️</div>
          <h2>Error Loading Quiz</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Result screen after submission
  if (isExamCompleted && examResult) {
    const total = totalQuestions || 5;
    const scorePct = Math.round((examResult.correct / total) * 100) || 0;

    return (
      <div className="quiz-page-container">
        <div className="card-container result-card">
          <div className="result-header">
            <div className="badge-pill success-pill">Assessment Completed</div>
            <h1>Exam Results & Evaluation</h1>
            <p>Your responses and proctoring audit have been saved locally.</p>
          </div>

          <div className="score-overview">
            <div className="score-circle">
              <span className="score-number">{scorePct}%</span>
              <span className="score-label">Final Score</span>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{examResult.attempted} / {total}</span>
                <span className="stat-title">Questions Attempted</span>
              </div>
              <div className="stat-card stat-correct">
                <span className="stat-value">{examResult.correct}</span>
                <span className="stat-title">Correct Answers</span>
              </div>
              <div className="stat-card stat-wrong">
                <span className="stat-value">{examResult.wrong}</span>
                <span className="stat-title">Incorrect Answers</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{formatTimer(timer)}</span>
                <span className="stat-title">Time Taken</span>
              </div>
            </div>
          </div>

          <div className="proctoring-summary-card">
            <h4>Proctoring & Audit Trail</h4>
            <p>Session ID: <code>{session?.sessionId}</code></p>
            <p>Candidate: <strong>{session?.name || 'Vaibhav'}</strong> ({session?.userId || 'student-101'})</p>
            <div className="proctor-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', margin: '12px 0' }}>
              <div className="proctor-stat-box" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Webcam Snaps (5s):</span>
                <p style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '4px 0 0 0' }}>📸 {snapshotCount}</p>
              </div>
              <div className="proctor-stat-box" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Screen Captures (5s):</span>
                <p style={{ fontSize: '18px', fontWeight: '700', color: '#2563eb', margin: '4px 0 0 0' }}>🖥️ {screenSnapshotCount}</p>
              </div>
            </div>
            {lastSavedSnap && (
              <p className="subtext-hint">Last camera snapshot: <code>{lastSavedSnap}</code></p>
            )}
            {lastSavedScreenSnap && (
              <p className="subtext-hint" style={{ marginTop: '4px' }}>Last screen capture: <code>{lastSavedScreenSnap}</code></p>
            )}
          </div>

          <div className="result-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {onStartNewExam && (
              <button className="btn btn-primary" onClick={onStartNewExam}>
                Start New Assessment
              </button>
            )}
            <button className="btn btn-black" onClick={onExitExam}>
              Close & Exit Exam
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-page-container">
      {/* Quiz Top Navbar */}
      <header className="quiz-navbar">
        <div className="nav-left">
          <div className="logo-badge">ATHENA</div>
          <div className="candidate-info">
            <span className="cand-name">{session?.name || 'Vaibhav'}</span>
            <span className="cand-id">ID: {session?.userId || 'student-101'}</span>
          </div>
        </div>

        <div className="nav-center">
          <div className="timer-badge">
            <span className="timer-icon">⏱️</span>
            <span className="timer-text">{formatTimer(timer)}</span>
          </div>
          <div className="answered-pill">
            {answeredCount} of {totalQuestions} Answered
          </div>
        </div>

        <div className="nav-right">
          {/* Live Proctoring Preview & Snaps Counter */}
          <div className="proctoring-pill">
            <span className="pulsing-dot"></span>
            <span className="proctor-text">
              Proctoring ({snapshotCount} cam • {screenSnapshotCount} screen)
            </span>
            <video
              ref={miniCamRef}
              autoPlay
              playsInline
              muted
              className="proctor-cam-mini"
              title="Webcam feed"
            />
            {onManualSnap && (
              <button
                className="snap-btn-quick"
                onClick={onManualSnap}
                title="Capture camera snapshot"
              >
                📸 Snap
              </button>
            )}
            {onManualScreenSnap && (
              <button
                className="snap-btn-quick"
                onClick={onManualScreenSnap}
                title="Capture screen now via desktopCapturer"
              >
                🖥️ Screen
              </button>
            )}
          </div>

          <button
            className="btn btn-outline btn-sm"
            onClick={onExitExam}
            title="Safe exit dialog"
          >
            Exit Exam
          </button>
        </div>
      </header>

      {/* Main Quiz Layout */}
      <div className="quiz-main-layout">
        {/* Left Column: Question Grid Palette */}
        <aside className="question-palette-sidebar">
          <h3 className="palette-title">Questions</h3>
          <div className="palette-grid">
            {questions.map((q, idx) => {
              const isCurrent = idx === currentIndex;
              const isAnswered = answers[q.id] !== undefined;

              let btnClass = 'palette-btn';
              if (isCurrent) btnClass += ' active';
              if (isAnswered) btnClass += ' answered';

              return (
                <button
                  key={q.id}
                  className={btnClass}
                  onClick={() => setCurrentIndex(idx)}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          <div className="palette-legend">
            <div className="legend-item">
              <span className="legend-dot active"></span>
              <span>Current</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot answered"></span>
              <span>Answered</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot"></span>
              <span>Unanswered</span>
            </div>
          </div>

          <div className="sidebar-submit-section">
            <button
              className="btn btn-primary btn-block"
              onClick={() => setShowConfirmSubmit(true)}
              disabled={submittingAction}
            >
              Submit Assessment
            </button>
          </div>
        </aside>

        {/* Center / Right Column: Active Question Card */}
        <main className="question-content-area">
          {currentQuestion ? (
            <div className="card-container question-card">
              <div className="question-meta">
                <span className="q-number-badge">
                  Question {currentIndex + 1} of {totalQuestions}
                </span>
                {answers[currentQuestion.id] !== undefined && (
                  <span className="answered-tag">Answer Selected</span>
                )}
              </div>

              <h2 className="question-text">{currentQuestion.question}</h2>

              {/* Options */}
              <div className="options-container">
                {currentQuestion.options.map((optionText, optIdx) => {
                  const isSelected = answers[currentQuestion.id] === optIdx;
                  const optionLabel = String.fromCharCode(65 + optIdx); // A, B, C, D

                  return (
                    <div
                      key={optIdx}
                      className={`option-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectOption(optIdx)}
                    >
                      <div className="option-letter">{optionLabel}</div>
                      <div className="option-text">{optionText}</div>
                      <div className="radio-indicator">
                        {isSelected && <div className="radio-dot"></div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Navigation and Actions */}
              <div className="question-actions-row">
                <button
                  className="btn btn-outline"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => i - 1)}
                >
                  ← Previous
                </button>

                <div className="right-question-btns">
                  {answers[currentQuestion.id] !== undefined && (
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        setAnswers((prev) => {
                          const updated = { ...prev };
                          delete updated[currentQuestion.id];
                          return updated;
                        });
                      }}
                    >
                      Clear Selection
                    </button>
                  )}

                  {currentIndex < totalQuestions - 1 ? (
                    <button
                      className="btn btn-black"
                      disabled={submittingAction}
                      onClick={handleSaveAnswer}
                    >
                      {answers[currentQuestion.id] !== undefined ? 'Save & Next →' : 'Skip / Next →'}
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={submittingAction}
                      onClick={() => setShowConfirmSubmit(true)}
                    >
                      Finish & Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card-container">
              <p>No question available.</p>
            </div>
          )}
        </main>
      </div>

      {/* Confirmation Modal */}
      {showConfirmSubmit && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Confirm Final Submission</h3>
            <p>
              You have answered <strong>{answeredCount}</strong> of <strong>{totalQuestions}</strong> questions.
            </p>
            {answeredCount < totalQuestions && (
              <p className="modal-warning">
                ⚠️ You have {totalQuestions - answeredCount} unanswered question(s). Are you sure you want to finish the exam now?
              </p>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => setShowConfirmSubmit(false)}
                disabled={submittingAction}
              >
                Return to Exam
              </button>
              <button
                className="btn btn-primary"
                onClick={handleFinalSubmit}
                disabled={submittingAction}
              >
                {submittingAction ? 'Submitting...' : 'Yes, Submit Exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
