'use client';

import React, { useEffect, useRef } from 'react';

interface MasonryLayoutProps {
  children: React.ReactNode;
  className?: string;
  columnWidth?: number;
  gap?: number;
}

const MasonryLayout: React.FC<MasonryLayoutProps> = ({ 
  children, 
  className = '',
  columnWidth = 300,
  gap = 24
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const items = Array.from(container.children) as HTMLElement[];
    
    // 초기화
    container.style.columnWidth = `${columnWidth}px`;
    container.style.columnGap = `${gap}px`;
    
    // 각 아이템에 break-inside 스타일 적용
    items.forEach(item => {
      item.style.breakInside = 'avoid';
      item.style.marginBottom = `${gap}px`;
    });
  }, [columnWidth, gap]);

  return (
    <div 
      ref={containerRef}
      className={`
        artist-masonry
        columns-auto
        break-inside-avoid
        ${className}
      `}
    >
      {children}
    </div>
  );
};

export default MasonryLayout;