# CC-Tool Web UI

Web UI for CC-Tool, built with Vue 3, Vite, and Tailwind CSS.

## Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

The dev server will start at `http://localhost:3000` and proxy API requests to the Express backend at `http://localhost:9999`.

### Build for Production

```bash
npm run build
```

The built files will be output to `../../dist/web/`.

## Architecture

### Frontend

- **Vue 3**: Composition API with `<script setup>` syntax
- **Pinia**: State management for sessions and aliases
- **Axios**: HTTP client for API calls
- **Tailwind CSS**: Utility-first CSS framework

### Components

- **App.vue**: Main application layout with project selector and session grid
- **SessionCard.vue**: Individual session card with inline alias editing, fork, and delete actions

### State Management

The `useSessionsStore` manages:
- Projects list
- Current project
- Sessions list with metadata
- Aliases mapping (sessionId -> alias name)
- CRUD operations for sessions and aliases

## API Integration

The web UI communicates with the Express backend at `/api`:

- `GET /api/projects` - Get all projects
- `GET /api/sessions/:projectName` - Get sessions for a project
- `POST /api/aliases` - Set alias for a session
- `DELETE /api/aliases/:sessionId` - Delete alias
- `DELETE /api/sessions/:projectName/:sessionId` - Delete session
- `POST /api/sessions/:projectName/:sessionId/fork` - Fork session

## Features

1. **Session Aliasing**: Rename sessions with custom aliases for easy identification
2. **Project Switching**: Switch between different Claude Code projects
3. **Session Search**: Filter sessions by alias, session ID, message, or branch name
4. **Fork Sessions**: Create a copy of an existing session
5. **Delete Sessions**: Remove unwanted sessions

## Development Workflow

1. Start the Express backend: `cc ui` (from CLI)
2. In another terminal, start the Vite dev server: `cd src/web && npm run dev`
3. Open `http://localhost:3000` in your browser
4. Changes to Vue components will hot-reload automatically

## Production

In production, the built web UI is served directly by the Express server at `http://localhost:9999`.
