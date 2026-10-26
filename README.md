# Athena Secure Examination Desktop Client

Athena is a secure, proctored desktop examination application engineered using **Electron**, **React 19**, **Vite**, and **Node.js/Express**. Built for institutional high-stakes assessments, Athena enforces strict test environment lockdown, multi-student identity verification, and synchronized dual-stream surveillance.

---

## Key Architectural Features

- **Decoupled Prerequisite State Machine**: Requires independent validation of both hardware webcam feed (Heimdall) and kiosk-level fullscreen lockdown before permitting candidate identity verification.
- **Dynamic Identity Verification & Single-Attempt Policy**: Enforces unique candidate authentication (Full Name & Enrollment Number) and queries backend records to prevent unauthorized multiple attempts.
- **Dual-Stream Surveillance Pipeline**: Captures candidate webcam video and high-resolution desktop screen frames every 1 second, segregating them into structured `camera/` and `screen/` directories.
- **Anti-Cheating Security Hardening**: 
  - Complete elimination of text drag selection and highlight colors (`user-select: none`, transparent selection pseudo-elements, default cursor).
  - Multi-tier interception of clipboard actions (`copy`, `cut`, `paste`) and keyboard shortcuts (`Ctrl/Cmd + C`, `V`, `X`, `A`, `P`, `S`, `U`) across both DOM capture listeners and Electron Chromium `webContents` `before-input-event`.
  - Disabling of right-click context menus and macOS system Edit menu accelerators.
- **Timed Guidelines Gateway**: 15-second mandatory rules review counter before automatic examination launch.
- **Zero Distraction UI**: Enterprise-grade interface free of emojis, redundant debug telemetry, and audit trail paths on student screens.

---

## AI Chat History & Development Log (Mid-Semester Evaluation)

As part of the mid-semester evaluation, the complete engineering development dialogue with AI assistance has been structured and documented. This log reflects student-driven requirement definitions, architectural decisions, security trade-offs, and iterative problem solving from initial prototyping to final distribution.

> 📄 **Complete AI Development Record**: Please refer to [README_AI_CHAT_HISTORY.md](file:///Users/ajeeshamreet/Downloads/Athena-Clone%203/README_AI_CHAT_HISTORY.md) for the exhaustive step-by-step chat history.

### Summary of Development Phases

| Phase | Milestone / Domain | Key Technical Implementation |
|---|---|---|
| **Phase 1** | Identity Verification & Single-Attempt Policy | Multi-student modal, backend session verification, attempt prevention |
| **Phase 2** | Results View Sanitization | Stripped internal storage paths, removed session ID, elevated core score metrics |
| **Phase 3** | Dual Surveillance Pipeline (1 Hz) | Separated `camera/` & `screen/` subfolders, Electron `desktopCapturer` 1s interval |
| **Phase 4** | Launchpad & Navbar Streamlining | Removed debug telemetry, replaced snapshot counter with pulsing proctoring pill |
| **Phase 5** | Unanswered Questions Modal | Clean submission confirmation modal reporting exact count of remaining questions |
| **Phase 6** | System-Wide Emoji Purge | Replaced all emoji indicators with custom, resolution-independent SVG icons |
| **Phase 7** | Rules Gateway & Countdown Gateway | Institutional rules view, 15-second decrement counter with dynamic green button |
| **Phase 8** | Hardware Readiness Decoupling | Decoupled Heimdall webcam & fullscreen into independent prerequisite gates |
| **Phase 9** | macOS Production Packaging | `electron-builder` configuration, entitlements, standalone `.dmg` generation |
| **Phase 10** | Anti-Cheating & Clipboard Lockdown | Disabled text drag/highlighting, blocked `Ctrl/Cmd + C/V`, blocked context menus |
| **Phase 11** | Release Verification & Cleanup | Purged testing artifacts, generated verified DMG (`Athena-1.0.0-arm64.dmg`) |
| **Phase 12** | Package Compression & Multi-Part (< 50MB) | Segmented DMG chunks (< 50MB each) via `hdiutil segment` & split zip |

---

## Project Structure

```text
Athena-Clone/
├── app/
│   ├── app.js               # Electron Main Process (Surveillance, IPC, Menus, Shortcuts)
│   ├── preload.js           # ContextBridge API exposing secure IPC channels
│   └── user-camera-snap/    # Surveillance storage root
│       ├── camera/          # 1-second interval candidate webcam captures
│       └── screen/          # 1-second interval desktop screen captures
├── backend/
│   ├── server.js            # Express server handling questions, scores, and sessions
│   └── data/
│       ├── questions.json   # Assessment item bank
│       └── sessions.json    # Candidate progress and completed attempt records
├── src/
│   ├── App.jsx              # Main application shell, readiness checks & rules modal
│   ├── QuizView.jsx         # Assessment interface, question palette & confirmation modal
│   ├── api.js               # Frontend API client
│   ├── App.css              # Custom enterprise design system and layout styling
│   └── main.jsx             # React entry point with global DOM security listeners
├── release/                 # Production distribution builds
│   └── Athena-1.0.0-arm64.dmg # macOS Apple Silicon installer
├── README.md                # Project overview and evaluation summary
└── README_AI_CHAT_HISTORY.md# Comprehensive AI chat history and development log
```

---

## Build & Run Instructions

### Development Mode
```bash
# 1. Install dependencies
npm install

# 2. Run React frontend and Electron desktop window
npm run electron
```

### Production Build & Packaging
```bash
# Compile Vite bundle and package macOS DMG installer
npm run dist
```
The output `.dmg` file will be generated in the `release/` directory.
