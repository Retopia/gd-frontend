# GD Rhythm Trainer - Frontend

React + Vite frontend for the Geometry Dash Rhythm Trainer application.

## Tech Stack

- **React 19.2.0** - UI framework
- **Vite 7.2.4** - Build tool and dev server
- **Tailwind CSS 4.1.18** - Styling
- **Lucide React** - Icons
- **React Toastify** - Notifications

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Environment Variables

Create a `.env` file in the frontend directory (copy from `.env.example`):

```bash
VITE_API_URL=http://localhost:8000
```

- `VITE_API_URL` - Backend API URL (default: `http://localhost:8000`)

## Health Check

For monitoring and Coolify deployments:

**Endpoint:** `/health.json`

Returns:
```json
{
  "status": "healthy",
  "service": "GD Rhythm Trainer Frontend"
}
```

## Features

- Upload and manage .gdr map files
- Upload and manage music files
- Practice rhythm timing with visual feedback
- Adjustable playback speed
- Practice specific sections of maps
- Download maps and music as zip files
- Real-time storage usage tracking

## Deployment

### Coolify

**Health Check Path:** `/health.json`
**Port:** 4173 (preview) or 80 (with nginx)

Set the `VITE_API_URL` environment variable to your backend URL.
