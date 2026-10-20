const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const defaultDataDir = path.join(__dirname, "data");
const targetDataDir = process.env.USER_DATA_PATH || defaultDataDir;

if (!fs.existsSync(targetDataDir)) {
  try {
    fs.mkdirSync(targetDataDir, { recursive: true });
  } catch (err) {
    console.warn("Could not create targetDataDir:", err);
  }
}

const questionsPath = (process.env.USER_DATA_PATH && fs.existsSync(path.join(process.env.USER_DATA_PATH, "questions.json")))
  ? path.join(process.env.USER_DATA_PATH, "questions.json")
  : path.join(defaultDataDir, "questions.json");

const sessionsPath = path.join(targetDataDir, "sessions.json");

if (!fs.existsSync(sessionsPath)) {
  const initialSessionsPath = path.join(defaultDataDir, "sessions.json");
  if (fs.existsSync(initialSessionsPath)) {
    try {
      fs.copyFileSync(initialSessionsPath, sessionsPath);
    } catch {
      fs.writeFileSync(sessionsPath, "[]");
    }
  } else {
    fs.writeFileSync(sessionsPath, "[]");
  }
}

function readQuestions() {
  return JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
}

function readSessions() {
  try {
    if (!fs.existsSync(sessionsPath)) return [];
    return JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function makeSessionId() {
  return `session-${Date.now()}`;
}

function questionForStudent(question) {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

app.get("/", (req, res) => {
  res.json({ message: "Exam backend is running" });
});

// Check if student has an existing submitted or in-progress session
app.get("/exam/student/:userId", (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ message: "userId is required" });
  }

  const sessions = readSessions();
  const normalizedId = userId.trim().toLowerCase();

  const submittedSessions = sessions.filter(
    (item) => item.userId && item.userId.trim().toLowerCase() === normalizedId && item.status === "submitted"
  );
  const submittedSession = submittedSessions.length > 0
    ? submittedSessions[submittedSessions.length - 1]
    : null;

  const inProgressSessions = sessions.filter(
    (item) => item.userId && item.userId.trim().toLowerCase() === normalizedId && item.status === "in-progress"
  );
  const inProgressSession = inProgressSessions.length > 0
    ? inProgressSessions[inProgressSessions.length - 1]
    : null;

  res.json({
    userId,
    alreadySubmitted: !!submittedSession,
    submittedSession,
    hasInProgress: !!inProgressSession,
    inProgressSession,
  });
});

// Start or resume an exam session
app.post("/exam/start", (req, res) => {
  const { userId, name, reset } = req.body;

  if (!userId || !name) {
    return res.status(400).json({
      message: "userId and name are required",
    });
  }

  const sessions = readSessions();
  const normalizedId = userId.trim().toLowerCase();

  // If student has already submitted the test and reset is not requested
  if (!reset) {
    const submittedSession = sessions.find(
      (item) => item.userId && item.userId.trim().toLowerCase() === normalizedId && item.status === "submitted"
    );

    if (submittedSession) {
      return res.status(403).json({
        message: "Student has already finished the test",
        alreadySubmitted: true,
        session: submittedSession,
      });
    }

    // If an in-progress session already exists for this user, resume it
    const existingSession = sessions.find(
      (item) => item.userId && item.userId.trim().toLowerCase() === normalizedId && item.status === "in-progress"
    );

    if (existingSession) {
      return res.json({
        message: "Resumed active exam session",
        sessionId: existingSession.sessionId,
        session: existingSession,
      });
    }
  }

  const session = {
    sessionId: makeSessionId(),
    userId,
    name,
    startedAt: new Date().toISOString(),
    submittedAt: null,
    status: "in-progress",
    attempted: 0,
    correct: 0,
    wrong: 0,
    answers: [],
  };

  sessions.push(session);
  saveSessions(sessions);

  res.status(201).json({
    message: "Exam session started",
    sessionId: session.sessionId,
    session,
  });
});

// Get one question
app.get("/exam/mcq/:id", (req, res) => {
  const questions = readQuestions();
  const id = Number(req.params.id);

  const question = questions.find((item) => item.id === id);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  res.json(questionForStudent(question));
});

// Get all questions without correct answers
app.get("/exam/mcq", (req, res) => {
  const questions = readQuestions();
  res.json(questions.map(questionForStudent));
});

// Submit one answer
app.post("/exam/answer", (req, res) => {
  const { sessionId, questionId, selectedAnswer } = req.body;

  if (!sessionId || questionId === undefined || selectedAnswer === undefined) {
    return res.status(400).json({
      message: "sessionId, questionId and selectedAnswer are required",
    });
  }

  const questions = readQuestions();
  const sessions = readSessions();

  const question = questions.find(
    (item) => item.id === Number(questionId)
  );

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  const alreadyAnswered = session.answers.find(
    (answer) => answer.questionId === Number(questionId)
  );

  if (alreadyAnswered) {
    if (alreadyAnswered.selectedAnswer !== Number(selectedAnswer)) {
      if (alreadyAnswered.isCorrect) session.correct -= 1;
      else session.wrong -= 1;

      const isCorrect = Number(selectedAnswer) === question.correctAnswer;
      alreadyAnswered.selectedAnswer = Number(selectedAnswer);
      alreadyAnswered.isCorrect = isCorrect;
      alreadyAnswered.answeredAt = new Date().toISOString();

      if (isCorrect) session.correct += 1;
      else session.wrong += 1;

      saveSessions(sessions);
    }

    return res.json({
      message: "Answer updated",
      isCorrect: alreadyAnswered.isCorrect,
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
    });
  }

  const isCorrect = Number(selectedAnswer) === question.correctAnswer;

  session.answers.push({
    questionId: question.id,
    selectedAnswer: Number(selectedAnswer),
    isCorrect,
    answeredAt: new Date().toISOString(),
  });

  session.attempted += 1;

  if (isCorrect) {
    session.correct += 1;
  } else {
    session.wrong += 1;
  }

  saveSessions(sessions);

  res.json({
    message: "Answer saved",
    isCorrect,
    attempted: session.attempted,
    correct: session.correct,
    wrong: session.wrong,
  });
});

// Get current session progress
app.get("/exam/session/:sessionId", (req, res) => {
  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === req.params.sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  res.json(session);
});

// Submit the whole exam
app.post("/exam/submit", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  session.status = "submitted";
  session.submittedAt = new Date().toISOString();

  saveSessions(sessions);

  res.json({
    message: "Exam submitted successfully",
    result: {
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
    },
  });
});

app.listen(PORT, () => {
  console.log(`Exam backend running at http://localhost:${PORT}`);
});
