"use client";

import { useEffect, useState } from "react";

/**
 * Looping animated explainer for the platform's value loop:
 *   launch an agent → people pay per call → revenue pools in its vault →
 *   IPO shares of that revenue → the builder collects the proceeds.
 * Plain-language, real DOM/CSS motion (no ASCII), respects reduced-motion.
 */

const STEPS = [
  {
    n: "01",
    label: "Launch",
    caption: "Launch your agent and set what one call costs — say $1.00.",
  },
  {
    n: "02",
    label: "Get paid",
    caption: "Anyone can pay per call to talk with it. Every call pays the agent.",
  },
  {
    n: "03",
    label: "Vault fills",
    caption: "Those payments pool in the agent's on-chain vault — real revenue, growing.",
  },
  {
    n: "04",
    label: "IPO",
    caption: "IPO shares of that revenue. You collect the proceeds; holders earn on every future call.",
  },
] as const;

export function LaunchFlow() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3000);
    return () => clearInterval(id);
  }, []);

  const scene =
    step === 0 ? <LaunchScene /> : step === 1 ? <PayScene /> : step === 2 ? <VaultScene /> : <IpoScene />;

  return (
    <div className="lf">
      <div className="lf-rail">
        {STEPS.map((s, i) => (
          <div key={s.n} className={`lf-step ${i === step ? "on" : i < step ? "done" : ""}`}>
            <span className="lf-step-n">{s.n}</span>
            <span className="lf-step-l">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="lf-stage">
        <div className="lf-scene" key={step}>
          {scene}
        </div>
      </div>

      <p className="lf-caption" key={`cap-${step}`}>
        {(STEPS[step] ?? STEPS[0]).caption}
      </p>
    </div>
  );
}

function LaunchScene() {
  return (
    <div className="lf-card">
      <div className="lf-card-top">
        <span className="lf-tk">$AUDIT</span>
        <span className="lf-tag">live</span>
      </div>
      <div className="lf-name">your solidity audit agent</div>
      <div className="lf-price">
        <span className="lf-price-v">$1.00</span>
        <span className="lf-price-l">per call</span>
      </div>
    </div>
  );
}

function PayScene() {
  return (
    <div className="lf-pay">
      <div className="lf-pay-agent">$AUDIT</div>
      <div className="lf-pay-stack">
        {[0, 1, 2].map((i) => (
          <span key={i} className="lf-pay-chip" style={{ animationDelay: `${0.15 + i * 0.4}s` }}>
            + $1.00
          </span>
        ))}
      </div>
      <div className="lf-pay-sub">people pay per call to use it</div>
    </div>
  );
}

function VaultScene() {
  return (
    <div className="lf-vault">
      <div className="lf-vault-top">
        <span className="lf-vault-label">agent vault</span>
        <span className="lf-vault-amt">$1,240</span>
      </div>
      <div className="lf-vault-box">
        <span className="lf-vault-fill" />
      </div>
      <div className="lf-vault-sub">every paid call flows in — and keeps growing</div>
    </div>
  );
}

function IpoScene() {
  return (
    <div className="lf-ipo">
      <div className="lf-ipo-head">
        <span>IPO · 1,000,000 shares</span>
        <span className="lf-ipo-price">$1.00 / sh</span>
      </div>
      <div className="lf-bar">
        <span className="lf-bar-fill" />
      </div>
      <div className="lf-ipo-earn">
        <span className="lf-ipo-arrow">→</span> you collect <b>$720,000</b>
      </div>
      <div className="lf-holders">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="lf-h" style={{ animationDelay: `${0.5 + i * 0.12}s` }} />
        ))}
        <span className="lf-h-more">holders earn on every call</span>
      </div>
    </div>
  );
}
