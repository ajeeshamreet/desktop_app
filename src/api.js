// src/api.js
const DEFAULT_BACKEND_URL = 'http://localhost:3000';

let cachedBaseUrl = null;

// Built-in fallback questions in case backend questions are ever unreachable
const FALLBACK_QUESTIONS = [
  {
    id: 1,
    question: "Which Electron process is responsible for creating BrowserWindow?",
    options: [
      "Renderer Process",
      "Main Process",
      "React Process",
      "Preload Process"
    ]
  },
  {
    id: 2,
    question: "Which Electron API is commonly used in the renderer to invoke a handler in the main process?",
    options: [
      "ipcRenderer.invoke",
      "BrowserWindow.loadURL",
      "fs.writeFileSync",
      "dialog.showMessageBox"
    ]
  },
  {
    id: 3,
    question: "Why is a preload script commonly used in Electron?",
    options: [
      "To style the React application",
      "To expose controlled APIs safely to the renderer",
      "To create the Express server",
      "To replace the main process"
    ]
  },
  {
    id: 4,
    question: "Which HTTP method is normally used to fetch exam questions?",
    options: [
      "GET",
      "DELETE",
      "PATCH",
      "CONNECT"
    ]
  },
  {
    id: 5,
    question: "What does fs.writeFileSync() do?",
    options: [
      "Reads camera frames",
      "Writes data to a file and waits until it finishes",
      "Starts the Electron renderer",
      "Sends an IPC event"
    ]
  }
];

export async function getBackendBaseUrl() {
  if (cachedBaseUrl) return cachedBaseUrl;

  if (window.athena?.getBackendUrl) {
    try {
      const url = await window.athena.getBackendUrl();
      if (url) {
        cachedBaseUrl = url;
        return url;
      }
    } catch {
      // fallback
    }
  }
  cachedBaseUrl = DEFAULT_BACKEND_URL;
  return DEFAULT_BACKEND_URL;
}

export async function checkBackendHealth() {
  const baseUrl = await getBackendBaseUrl();
  const res = await fetch(`${baseUrl}/`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Backend returned status ${res.status}`);
  }
  return res.json();
}

// Local Session Helpers
export function getLocalActiveSession() {
  try {
    const raw = localStorage.getItem('athena_active_session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session && session.status === 'in-progress') {
      return session;
    }
  } catch {
    // ignore parse error
  }
  return null;
}

export function saveLocalActiveSession(session) {
  try {
    localStorage.setItem('athena_active_session', JSON.stringify(session));
    if (window.athena?.saveLocalSession) {
      window.athena.saveLocalSession(session).catch(() => {});
    }
  } catch (err) {
    console.warn('Could not save local active session:', err);
  }
}

export function clearLocalActiveSession() {
  try {
    localStorage.removeItem('athena_active_session');
  } catch {
    // ignore
  }
}

// Check if a student has already submitted or attempted the exam
export async function checkStudentStatus(userId, name) {
  const normalizedId = (userId || '').trim().toLowerCase();
  if (!normalizedId) {
    return { alreadySubmitted: false, session: null };
  }

  // 1. Check Electron local sessions via IPC if available
  if (window.athena?.getLocalSessions) {
    try {
      const localSessions = await window.athena.getLocalSessions();
      if (Array.isArray(localSessions)) {
        const submitted = localSessions.find(
          (s) => s.userId && s.userId.trim().toLowerCase() === normalizedId && s.status === 'submitted'
        );
        if (submitted) {
          return {
            alreadySubmitted: true,
            session: submitted,
            message: 'Student has already finished the test'
          };
        }
      }
    } catch (err) {
      console.warn('Error checking Electron local-sessions:', err);
    }
  }

  // 2. Check localStorage active or submitted session
  try {
    const raw = localStorage.getItem('athena_active_session');
    if (raw) {
      const session = JSON.parse(raw);
      if (session?.userId && session.userId.trim().toLowerCase() === normalizedId && session.status === 'submitted') {
        return {
          alreadySubmitted: true,
          session,
          message: 'Student has already finished the test'
        };
      }
    }
  } catch (err) {
    console.warn('Error checking localStorage:', err);
  }

  // 3. Check Backend /exam/student/:userId
  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/exam/student/${encodeURIComponent(userId.trim())}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.alreadySubmitted) {
        return {
          alreadySubmitted: true,
          session: data.submittedSession,
          message: 'Student has already finished the test'
        };
      }
      return {
        alreadySubmitted: false,
        hasInProgress: data.hasInProgress,
        session: data.inProgressSession || null
      };
    }
  } catch (err) {
    console.warn('Backend /exam/student check unreachable:', err);
  }

  return {
    alreadySubmitted: false,
    session: null
  };
}

// Start or Resume Exam Session locally and on backend
export async function startExamSession(userId, name, forceNew = false) {
  const cleanId = (userId || 'student-101').trim();
  const cleanName = (name || 'Candidate').trim();

  // If not forcing new session, check if we already have an active in-progress local session
  if (!forceNew) {
    const local = getLocalActiveSession();
    if (local && local.userId && local.userId.trim().toLowerCase() === cleanId.toLowerCase()) {
      console.log('[Session] Reusing existing local in-progress session:', local.sessionId);
      return {
        message: 'Resumed local exam session',
        sessionId: local.sessionId,
        session: local
      };
    }
  }

  let sessionData = null;

  // Try backend first
  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/exam/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: cleanId, name: cleanName, reset: forceNew }),
    });

    if (res.ok) {
      const data = await res.json();
      sessionData = data.session || {
        sessionId: data.sessionId,
        userId: cleanId,
        name: cleanName,
        startedAt: new Date().toISOString(),
        status: 'in-progress',
        attempted: 0,
        correct: 0,
        wrong: 0,
        answers: []
      };
    } else {
      const errData = await res.json().catch(() => ({}));
      if (errData.alreadySubmitted || res.status === 403) {
        const error = new Error(errData.message || 'Student has already finished the test');
        error.alreadySubmitted = true;
        error.session = errData.session;
        throw error;
      }
    }
  } catch (err) {
    if (err.alreadySubmitted) throw err;
    console.warn('[Session] Backend start session unreachable, creating fully local session:', err);
  }

  // Fallback to pure local session if backend was not responding
  if (!sessionData) {
    sessionData = {
      sessionId: `local-session-${Date.now()}`,
      userId: cleanId,
      name: cleanName,
      startedAt: new Date().toISOString(),
      submittedAt: null,
      status: 'in-progress',
      attempted: 0,
      correct: 0,
      wrong: 0,
      answers: []
    };
  }

  saveLocalActiveSession(sessionData);

  return {
    message: 'Exam session started',
    sessionId: sessionData.sessionId,
    session: sessionData
  };
}

// Fetch exam questions with automatic fallback
export async function fetchQuestions() {
  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/exam/mcq`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      const questions = await res.json();
      if (Array.isArray(questions) && questions.length > 0) {
        return questions;
      }
    }
  } catch (err) {
    console.warn('[Questions] Could not reach backend /exam/mcq, using local questions:', err);
  }

  return FALLBACK_QUESTIONS;
}

// Submit one answer (persisting locally and forwarding to backend)
export async function submitAnswer(sessionId, questionId, selectedAnswer) {
  // Update local session
  const local = getLocalActiveSession();
  if (local && local.sessionId === sessionId) {
    if (!local.answers) local.answers = [];
    const existing = local.answers.find((a) => a.questionId === Number(questionId));
    if (existing) {
      existing.selectedAnswer = Number(selectedAnswer);
      existing.answeredAt = new Date().toISOString();
    } else {
      local.answers.push({
        questionId: Number(questionId),
        selectedAnswer: Number(selectedAnswer),
        answeredAt: new Date().toISOString()
      });
      local.attempted = (local.attempted || 0) + 1;
    }
    saveLocalActiveSession(local);
  }

  // Try backend sync
  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/exam/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        questionId,
        selectedAnswer,
      }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // backend offline, local answer preserved
  }

  return {
    message: 'Answer saved locally',
    isCorrect: null,
    attempted: local?.attempted || 1,
    correct: 0,
    wrong: 0
  };
}

// Submit the whole exam
export async function submitExam(sessionId) {
  let result = null;

  // Try backend submission
  try {
    const baseUrl = await getBackendBaseUrl();
    const res = await fetch(`${baseUrl}/exam/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (res.ok) {
      const data = await res.json();
      result = data.result;
    }
  } catch {
    // backend offline
  }

  // Finalize local session
  const local = getLocalActiveSession();
  if (local && local.sessionId === sessionId) {
    local.status = 'submitted';
    local.submittedAt = new Date().toISOString();
    if (result) {
      local.correct = result.correct;
      local.wrong = result.wrong;
      local.attempted = result.attempted;
    } else {
      local.attempted = local.answers?.length || 0;
    }
    saveLocalActiveSession(local);
  }

  // Clear active in-progress pointer
  clearLocalActiveSession();

  return {
    message: 'Exam submitted successfully',
    result: result || {
      attempted: local?.attempted || 0,
      correct: local?.correct || 0,
      wrong: local?.wrong || 0
    }
  };
}
