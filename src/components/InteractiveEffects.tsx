import React, { useState, useRef } from 'react';

// Liquid Hover Effect 컴포넌트
interface LiquidHoverEffectProps {
  children: React.ReactNode;
  className?: string;
}

const LiquidHoverEffect: React.FC<LiquidHoverEffectProps> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <div className={`
      liquid-hover
      relative
      overflow-hidden
      ${className}
    `}>
      {children}
    </div>
  );
};

// Morphing Button 컴포넌트
interface MorphingButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const MorphingButton: React.FC<MorphingButtonProps> = ({ 
  children, 
  className = '',
  onClick 
}) => {
  return (
    <button
      className={`
        morph-button
        px-6 py-3
        rounded-full
        transition-all
        duration-300
        transform
        hover:scale-105
        focus:outline-none
        focus:ring-2
        focus:ring-offset-2
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

// Particle Burst Effect 컴포넌트
interface ParticleBurstEffectProps {
  children: React.ReactNode;
  className?: string;
  particleCount?: number;
}

const ParticleBurstEffect: React.FC<ParticleBurstEffectProps> = ({ 
  children, 
  className = '',
  particleCount = 10
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [particles, setParticles] = useState<Array<{id: number, x: number, y: number}>>([]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newParticles = Array.from({ length: particleCount }, (_, i) => ({
      id: Date.now() + i,
      x,
      y
    }));
    
    setParticles(newParticles);
    
    // 파티클 애니메이션 후 제거
    setTimeout(() => {
      setParticles([]);
    }, 1000);
  };

  return (
    <div 
      ref={containerRef}
      className={`
        particle-burst
        relative
        overflow-hidden
        ${className}
      `}
      onClick={handleClick}
    >
      {children}
      
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute w-2 h-2 rounded-full bg-electric-400"
          style={{
            left: particle.x,
            top: particle.y,
            transform: 'translate(-50%, -50%)',
            animation: 'particleBurst 1s ease-out forwards'
          }}
        />
      ))}
    </div>
  );
};

export { LiquidHoverEffect, MorphingButton, ParticleBurstEffect };