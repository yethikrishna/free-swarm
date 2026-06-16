'use client';

import { useState } from 'react';

export default function Home() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  const faqs = [
    {
      question: "How is FreeSwarm different from a regular AI chatbot?",
      answer: "FreeSwarm is a full agent orchestrator, not just a chat interface. It lets you coordinate multiple agents in parallel, control their permissions, and integrate with your existing tools and workflows."
    },
    {
      question: "Who is FreeSwarm for?",
      answer: "FreeSwarm is designed for developers, researchers, and teams who want to leverage AI agents for complex tasks while maintaining full control and transparency over agent actions."
    },
    {
      question: "Is FreeSwarm free?",
      answer: "Yes! FreeSwarm is open-source and free to use. You can run it locally on your machine with no cloud dependencies."
    },
    {
      question: "Can agents use my own apps and tools?",
      answer: "Absolutely. FreeSwarm supports MCP servers and integrations, so agents can use any tools you connect - whether they're internal apps, APIs, or services."
    },
    {
      question: "What integrations are supported?",
      answer: "FreeSwarm supports MCP (Model Context Protocol) servers, giving access to thousands of integrations including GitHub, Slack, filesystem operations, and more."
    },
    {
      question: "Can I run FreeSwarm offline?",
      answer: "Yes. FreeSwarm runs entirely locally on your machine. There's no cloud relay or telemetry - your data and API keys stay on your device."
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="https://openswarm.info/logo.png" alt="FreeSwarm" className="w-8 h-8" />
            <span className="text-lg font-semibold text-gray-900">Free Swarm</span>
          </div>
          <a href="https://freeswarm.myndlabs.tech/app" className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4.5" width="16" height="11" rx="1.6"></rect>
              <line x1="2.5" y1="19.5" x2="21.5" y2="19.5"></line>
            </svg>
            Launch App
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
              Meet your new<br />
              AI Agent<br />
              Orchestrator
            </h1>
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              FreeSwarm is your open-source platform for coordinating multiple AI agents in parallel. One place for you and your agents to work together.
            </p>
            <a href="https://freeswarm.myndlabs.tech/app" className="inline-flex items-center gap-2 bg-gray-900 text-white px-8 py-4 rounded-lg hover:bg-gray-800 transition text-lg font-semibold">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="4.5" width="16" height="11" rx="1.6"></rect>
                <line x1="2.5" y1="19.5" x2="21.5" y2="19.5"></line>
              </svg>
              Try FreeSwarm Now
            </a>
          </div>
          <div className="bg-gray-100 rounded-xl overflow-hidden aspect-video">
            <video
              src="https://openswarm.info/Open%20Swarm%20Final%20Cut.mp4"
              autoPlay
              loop
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* Features Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-gray-900 mb-16 text-center">How FreeSwarm helps you get more done</h2>

        <div className="grid md:grid-cols-2 gap-16">
          <div>
            <p className="text-2xl font-bold text-gray-900 mb-4">Connects to your tools</p>
            <p className="text-gray-600 mb-6 text-lg leading-relaxed">
              FreeSwarm integrates with MCP servers and your existing tools. So your agents can use your tools the same way you do.
            </p>
            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video">
              <video
                src="https://openswarm.info/2%20-%20Tools.mp4"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div>
            <p className="text-2xl font-bold text-gray-900 mb-4">Agentic Browsers</p>
            <p className="text-gray-600 mb-6 text-lg leading-relaxed">
              Every agent in FreeSwarm can control a real browser. Watch them navigate, extract content, and interact with web pages in real time.
            </p>
            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video">
              <video
                src="https://openswarm.info/2%20-%20Browsers.mp4"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* App Builder Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="order-2 md:order-1 bg-gray-100 rounded-lg overflow-hidden aspect-video">
            <video
              src="https://openswarm.info/3%20-%20Apps.mp4"
              autoPlay
              loop
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
          <div className="order-1 md:order-2">
            <h2 className="text-4xl font-bold text-gray-900 mb-6">Infinite agent workflows</h2>
            <p className="text-lg text-gray-600 leading-relaxed">
              Define custom agent workflows and skills. Convert any task into a repeatable workflow that runs with one click. Build agent orchestrations that scale with your needs.
            </p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* Learning Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-gray-900 mb-16 text-center">A Platform that learns</h2>

        <div className="grid md:grid-cols-3 gap-8">
          <div>
            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video mb-6">
              <video
                src="https://openswarm.info/4%20-%20Never%20Twice.mp4"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-xl font-bold text-gray-900 mb-3">Never do a task twice</p>
            <p className="text-gray-600">Convert any agent interaction into a reusable workflow and run it with one click.</p>
          </div>

          <div>
            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video mb-6">
              <video
                src="https://openswarm.info/4%20-%20Evolve.mp4"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-xl font-bold text-gray-900 mb-3">Improving agents</p>
            <p className="text-gray-600">Agents learn from interactions and become smarter, faster, and more reliable over time.</p>
          </div>

          <div>
            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video mb-6">
              <video
                src="https://openswarm.info/4%20-%20Customize.mp4"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-xl font-bold text-gray-900 mb-3">Customize everything</p>
            <p className="text-gray-600">Control agent skills, permissions, behavior, and decision-making to match your exact needs.</p>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* Control Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="bg-gray-100 rounded-lg overflow-hidden aspect-video">
            <video
              src="https://openswarm.info/5%20-%20Controls.mp4"
              autoPlay
              loop
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>

          <div>
            <h2 className="text-4xl font-bold text-gray-900 mb-8">Stay in control</h2>

            <div className="space-y-8">
              <div className="border-l-4 border-gray-900 pl-6">
                <p className="text-xl font-bold text-gray-900 mb-2">Select and send</p>
                <p className="text-gray-600">Agents can control anything on your desktop or in your apps. Simply select what they can access.</p>
              </div>

              <div className="border-l-4 border-gray-300 pl-6">
                <p className="text-xl font-bold text-gray-900 mb-2">Set permissions</p>
                <p className="text-gray-600">Choose which actions need your approval, are always allowed, or denied completely.</p>
              </div>

              <div className="border-l-4 border-gray-300 pl-6">
                <p className="text-xl font-bold text-gray-900 mb-2">Stay high level</p>
                <p className="text-gray-600">Whenever your opinion or strategy is needed, agents will ask you directly before proceeding.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* FAQ Section */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold text-gray-900 mb-12 text-center">Frequently asked questions</h2>

        <div className="space-y-0">
          {faqs.map((faq, idx) => (
            <div key={idx} className={`border-b border-gray-200 ${idx === 0 ? 'border-t' : ''}`}>
              <button
                onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                className="w-full px-6 py-6 flex justify-between items-start hover:bg-gray-50 transition text-left"
              >
                <p className="text-lg font-semibold text-gray-900 pr-6">{faq.question}</p>
                <svg
                  className={`w-5 h-5 text-gray-600 transition-transform flex-shrink-0 mt-1 ${expandedFaq === idx ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {expandedFaq === idx && (
                <div className="px-6 pb-6 text-gray-600">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="h-px bg-gray-100 my-12"></div>

      {/* CTA Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 text-center">
        <h2 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
          An AI Platform that does the work, not just talks about it.
        </h2>
        <p className="text-xl text-gray-600 mb-10">
          Try FreeSwarm on your machine today. Open-source, free, and fully under your control.
        </p>
        <a href="https://freeswarm.myndlabs.tech/app" className="inline-flex items-center gap-2 bg-gray-900 text-white px-8 py-4 rounded-lg hover:bg-gray-800 transition text-lg font-semibold">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="4.5" width="16" height="11" rx="1.6"></rect>
            <line x1="2.5" y1="19.5" x2="21.5" y2="19.5"></line>
          </svg>
          Launch FreeSwarm
        </a>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white border-t border-gray-800 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-16">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <img src="https://openswarm.info/logo.png" alt="FreeSwarm" className="w-8 h-8" />
                <span className="font-bold text-lg">Free Swarm</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">Your open-source AI agent orchestrator. One place for you and your agents to work together.</p>
            </div>

            <div>
              <p className="font-bold text-white mb-6">Resources</p>
              <ul className="space-y-3 text-sm">
                <li><a href="https://github.com/yethikrishna/free-swarm" className="text-gray-400 hover:text-white transition">Source Code</a></li>
                <li><a href="https://github.com/yethikrishna/free-swarm/blob/main/GETTING_STARTED.md" className="text-gray-400 hover:text-white transition">Getting Started</a></li>
                <li><a href="https://github.com/yethikrishna/free-swarm/issues" className="text-gray-400 hover:text-white transition">Issues</a></li>
                <li><a href="https://github.com/yethikrishna/free-swarm/blob/main/LICENSE" className="text-gray-400 hover:text-white transition">MIT License</a></li>
              </ul>
            </div>

            <div>
              <p className="font-bold text-white mb-6">Community</p>
              <ul className="space-y-3 text-sm">
                <li><span className="text-gray-400">Discord - Coming Soon</span></li>
                <li><span className="text-gray-400">Twitter - Coming Soon</span></li>
                <li><a href="https://github.com/yethikrishna/free-swarm" className="text-gray-400 hover:text-white transition">GitHub</a></li>
              </ul>
            </div>

            <div>
              <p className="font-bold text-white mb-6">Legal</p>
              <ul className="space-y-3 text-sm">
                <li><span className="text-gray-400">Privacy Policy - Coming Soon</span></li>
                <li><span className="text-gray-400">Terms of Service - Coming Soon</span></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-8 flex justify-between items-center">
            <p className="text-gray-400 text-sm">© 2026 Free Swarm. MIT License.</p>
            <p className="text-gray-400 text-sm">Follow us - Coming Soon</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
