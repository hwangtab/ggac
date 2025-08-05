import React, { useEffect, useRef, useState } from 'react';

interface ScrollAnimationProps {
  children: React.ReactNode;
  className?: string;
  animationType?: 'fadeIn' | 'slideUp' | 'scaleIn' | 'rotateIn';
  duration?: number;
  delay?: number;
  threshold?: number; // 0에서 1 사이의 값, 요소가 얼마나 보여야 애니메이션을 시작할지
}

const ScrollAnimation: React.FC<ScrollAnimationProps> = ({ 
  children, 
  className = '',
  animationType = 'fadeIn',
  duration = 800,
  delay = 0,
  threshold = 0.1
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      {
        threshold: threshold
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold]);

  const getAnimationClass = () => {
    switch (animationType) {
      case 'fadeIn':
        return isVisible ? 'animate-fade-in' : 'opacity-0';
      case 'slideUp':
        return isVisible ? 'animate-slide-up' : 'opacity-0 translate-y-10';
      case 'scaleIn':
        return isVisible ? 'animate-scale-in' : 'opacity-0 scale-90';
      case 'rotateIn':
        return isVisible ? 'animate-rotate-in' : 'opacity-0 rotate-12';
      default:
        return isVisible ? 'animate-fade-in' : 'opacity-0';
    }
  };

  return (
    <div
      ref={elementRef}
      className={`
        transition-all
        ease-out
        ${getAnimationClass()}
        ${className}
      `}
      style={{
        transitionDuration: `${duration}ms`,
        transitionDelay: `${delay}ms`
      }}
    >
      {children}
    </div>
  );
};

export default ScrollAnimation;