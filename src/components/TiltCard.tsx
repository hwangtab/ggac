"use client";

import React, { useState, useRef, useEffect } from 'react';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  tiltEffect?: 'smooth' | 'sharp';
  theme?: 'electric' | 'neon' | 'gold' | 'cosmic';
}

const TiltCard: React.FC<TiltCardProps> = ({ 
  children, 
  className = '',
  tiltEffect = 'smooth',
  theme = 'electric'
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<string>('');
  const [isHovered, setIsHovered] = useState<boolean>(false);

  const themeClasses = {
    electric: 'artist-theme-electric',
    neon: 'artist-theme-neon',
    gold: 'artist-theme-gold',
    cosmic: 'artist-theme-cosmic'
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    
    const card = cardRef.current;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateY = ((x - centerX) / centerX) * 15; // 최대 15도
    const rotateX = ((centerY - y) / centerY) * 15; // 최대 15도
    const translateZ = 50; // Z축 이동
    
    const effect = tiltEffect === 'smooth' 
      ? 'cubic-bezier(0.23, 1, 0.32, 1)' 
      : 'cubic-bezier(0.4, 0, 0.2, 1)';
    
    setTransform(`
      perspective(1000px) 
      rotateX(${rotateX}deg) 
      rotateY(${rotateY}deg) 
      translateZ(${translateZ}px)
    `);
    
    card.style.transition = `transform 0.1s ${effect}`;
  };

  const handleMouseLeave = () => {
    if (!cardRef.current) return;
    
    const card = cardRef.current;
    const effect = tiltEffect === 'smooth' 
      ? 'cubic-bezier(0.23, 1, 0.32, 1)' 
      : 'cubic-bezier(0.4, 0, 0.2, 1)';
    
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)');
    card.style.transition = `transform 0.6s ${effect}`;
    setIsHovered(false);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  return (
    <div 
      ref={cardRef}
      className={`
        artist-card-3d
        ${themeClasses[theme]}
        rounded-3xl
        overflow-hidden
        transition-all
        duration-300
        ${className}
      `}
      style={{ 
        transform: transform,
        transformStyle: 'preserve-3d'
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
    >
      <div 
        className={`
          w-full 
          h-full
          ${isHovered ? 'transition-all duration-300' : ''}
        `}
        style={{ 
          transform: 'translateZ(50px)',
          transformStyle: 'preserve-3d'
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default TiltCard;