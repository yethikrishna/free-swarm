# FreeSwarm Marketing Website

A modern, responsive marketing website for FreeSwarm built with Next.js and Tailwind CSS.

## Features

- 🎨 Modern, responsive design
- ⚡ Fast performance with Next.js
- 🎭 Smooth animations with Framer Motion
- 📱 Mobile-first approach
- 🌙 Dark mode by default
- ♿ Accessible components

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
npm run build
npm start
```

## Deployment to Vercel

### Option 1: Using Vercel CLI

```bash
npm install -g vercel
vercel deploy
```

### Option 2: GitHub Integration

1. Push this directory to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import the GitHub repository
4. Vercel will auto-detect the `vercel.json` configuration
5. Deploy!

### Option 3: Manual Deployment

1. Go to [vercel.com/new](https://vercel.com/new)
2. Select "Other" as project type
3. Configure build settings:
   - Build Command: `npm run build`
   - Output Directory: `.next/standalone`
4. Add environment variables if needed
5. Deploy!

## Custom Domain

After deployment, connect your custom domain:

1. In Vercel dashboard → Project Settings → Domains
2. Add domain: `freeswarm.myndlabs.tech`
3. Update DNS records with the CNAME provided by Vercel

## Directory Structure

```
website/
├── app/
│   ├── page.tsx          # Main landing page
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── public/               # Static assets
├── next.config.js        # Next.js configuration
├── tailwind.config.js    # Tailwind CSS configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

## Technologies

- **Next.js 15** - React framework
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **TypeScript** - Type safety

## License

MIT - See main repository LICENSE

## Built by

[Mynd Labs](https://myndlabs.tech)
