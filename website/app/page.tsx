'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
};

export default function Home() {
  const features = [
    {
      title: 'Spatial Dashboard',
      description: 'Manage multiple agents on an infinite canvas. Drag, pan, zoom freely across your entire workflow.',
      icon: '🎯',
    },
    {
      title: 'Real-time Approvals',
      description: 'Every tool request surfaces in one place. Approve or deny with a single click or keyboard shortcut.',
      icon: '✓',
    },
    {
      title: 'Message Branching',
      description: 'Edit previous messages to fork conversations. Navigate between branches without losing context.',
      icon: '🔀',
    },
    {
      title: 'Built-in Browser',
      description: 'Agents control real browser windows. Watch them navigate, extract content, and interact with the web.',
      icon: '🌐',
    },
    {
      title: 'App Builder',
      description: 'Scaffold and launch full web applications. Live preview, persistent state, no context switching.',
      icon: '⚙️',
    },
    {
      title: 'MCP Integration',
      description: 'Connect any MCP server. GitHub, Slack, filesystem, and more. Full approval flow everywhere.',
      icon: '🔗',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Navigation */}
      <nav className="border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            FreeSwarm
          </div>
          <div className="flex gap-6">
            <a href="#features" className="text-slate-400 hover:text-white transition">Features</a>
            <a href="https://github.com/yethikrishna/free-swarm" className="text-slate-400 hover:text-white transition">GitHub</a>
            <a href="https://freeswarm.myndlabs.tech/app" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
              Launch App
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <motion.div
          className="text-center"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-5xl sm:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent"
            variants={itemVariants}
          >
            An Army of AI Agents at Your Fingertips
          </motion.h1>

          <motion.p
            className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto leading-relaxed"
            variants={itemVariants}
          >
            Launch, monitor, and coordinate multiple AI agents in parallel from a single interface.
            Everything runs locally. No cloud relay. No telemetry.
          </motion.p>

          <motion.div
            className="flex gap-4 justify-center flex-wrap"
            variants={itemVariants}
          >
            <a
              href="https://freeswarm.myndlabs.tech/app"
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-8 py-3 rounded-lg font-semibold transition transform hover:scale-105"
            >
              Try Now →
            </a>
            <a
              href="https://github.com/yethikrishna/free-swarm"
              className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-8 py-3 rounded-lg font-semibold transition"
            >
              View on GitHub
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Why FreeSwarm Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 border-t border-slate-800">
        <motion.div
          className="grid md:grid-cols-2 gap-12 items-center"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.div variants={itemVariants}>
            <h2 className="text-3xl font-bold mb-6">Why FreeSwarm?</h2>
            <ul className="space-y-4 text-slate-300">
              <li className="flex gap-3">
                <span className="text-cyan-400 flex-shrink-0">✓</span>
                <span><strong>Parallel Agents:</strong> Launch as many agents as you need on one screen</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 flex-shrink-0">✓</span>
                <span><strong>Unified Control:</strong> Every approval request in one place</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 flex-shrink-0">✓</span>
                <span><strong>Full Visibility:</strong> Real-time monitoring of all agents</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan-400 flex-shrink-0">✓</span>
                <span><strong>Local Control:</strong> No cloud dependency, no telemetry</span>
              </li>
            </ul>
          </motion.div>

          <motion.div
            className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 border border-slate-700 rounded-lg p-8"
            variants={itemVariants}
          >
            <div className="aspect-video bg-slate-800 rounded-lg flex items-center justify-center text-slate-500">
              [Dashboard Preview]
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-slate-800">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.h2
            className="text-4xl font-bold text-center mb-16"
            variants={itemVariants}
          >
            Powerful Features
          </motion.h2>

          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, idx) => (
              <motion.div
                key={idx}
                className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-6 hover:border-cyan-500/50 transition hover:shadow-lg hover:shadow-cyan-500/10"
                variants={itemVariants}
              >
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-slate-400">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Tech Stack Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-slate-800">
        <motion.div
          className="grid md:grid-cols-3 gap-12"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.div variants={itemVariants}>
            <h3 className="text-2xl font-bold mb-4">⚡ Fast</h3>
            <p className="text-slate-400">Real-time WebSocket streaming for instant agent feedback and token-by-token output.</p>
          </motion.div>

          <motion.div variants={itemVariants}>
            <h3 className="text-2xl font-bold mb-4">🔒 Private</h3>
            <p className="text-slate-400">Everything runs locally. Your API keys stay on your machine. Zero cloud dependencies.</p>
          </motion.div>

          <motion.div variants={itemVariants}>
            <h3 className="text-2xl font-bold mb-4">🛠️ Flexible</h3>
            <p className="text-slate-400">Works with any LLM provider. OpenAI, Claude, local models, or custom endpoints.</p>
          </motion.div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 border-t border-slate-800">
        <motion.div
          className="bg-gradient-to-r from-blue-900/40 to-cyan-900/40 border border-blue-700/50 rounded-lg p-12 text-center"
          variants={itemVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <h2 className="text-3xl font-bold mb-4">Ready to orchestrate your AI agents?</h2>
          <p className="text-slate-300 mb-8">Start with the web version or download the desktop app.</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a
              href="https://freeswarm.myndlabs.tech/app"
              className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white px-8 py-3 rounded-lg font-semibold transition"
            >
              Launch Web App
            </a>
            <a
              href="https://github.com/yethikrishna/free-swarm/releases"
              className="border border-blue-500 text-blue-300 hover:text-white px-8 py-3 rounded-lg font-semibold transition"
            >
              Download Desktop
            </a>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-12 mt-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-slate-500">
          <p className="mb-4">
            Built by <a href="https://myndlabs.tech" className="text-blue-400 hover:text-blue-300">Mynd Labs</a> •
            <a href="https://github.com/yethikrishna/free-swarm" className="text-blue-400 hover:text-blue-300 ml-2">Open Source</a> •
            <a href="https://github.com/yethikrishna/free-swarm/blob/main/LICENSE" className="text-blue-400 hover:text-blue-300 ml-2">MIT License</a>
          </p>
          <p>An Army of AI Agents at Your Fingertips</p>
        </div>
      </footer>
    </div>
  );
}
