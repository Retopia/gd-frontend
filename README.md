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

The frontend expects the backend API to be running at `http://localhost:8000`. You can modify this in `src/api.js` if needed.

## Features

- Upload and manage .gdr map files
- Upload and manage music files
- Practice rhythm timing with visual feedback
- Adjustable playback speed
- Practice specific sections of maps
- Download maps and music as zip files
- Real-time storage usage tracking
