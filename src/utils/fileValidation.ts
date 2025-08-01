/**
 * 파일 업로드 보안 검증 유틸리티
 * 파일 확장자, MIME 타입, 매직 바이트 검증
 */

import type { StrictFileValidationResult } from '@/types';

// 허용된 파일 타입과 해당 매직 바이트 정의
interface FileTypeSignature {
  extensions: string[];
  mimeTypes: string[];
  magicBytes: number[][];
  maxSize: number; // bytes
}

const FILE_SIGNATURES: Record<string, FileTypeSignature> = {
  image: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    magicBytes: [
      [0xFF, 0xD8, 0xFF], // JPEG
      [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], // PNG
      [0x47, 0x49, 0x46, 0x38], // GIF
      [0x52, 0x49, 0x46, 0x46], // WebP (RIFF header)
    ],
    maxSize: 5 * 1024 * 1024, // 5MB
  },
  document: {
    extensions: ['.pdf', '.doc', '.docx'],
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    magicBytes: [
      [0x25, 0x50, 0x44, 0x46], // PDF
      [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // DOC
      [0x50, 0x4B, 0x03, 0x04], // DOCX (ZIP-based)
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  video: {
    extensions: ['.mp4', '.webm'],
    mimeTypes: ['video/mp4', 'video/webm'],
    magicBytes: [
      [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], // MP4
      [0x1A, 0x45, 0xDF, 0xA3], // WebM
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
  audio: {
    extensions: ['.mp3', '.wav'],
    mimeTypes: ['audio/mpeg', 'audio/wav'],
    magicBytes: [
      [0xFF, 0xFB], // MP3
      [0x49, 0x44, 0x33], // MP3 with ID3
      [0x52, 0x49, 0x46, 0x46], // WAV (RIFF header)
    ],
    maxSize: 20 * 1024 * 1024, // 20MB
  },
};

// 위험한 파일 확장자 (실행 파일 등)
const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.dll',
  '.jar', '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.js', '.vbs', '.ps1', '.sh', '.py', '.php', '.asp',
  '.jsp', '.htm', '.html', '.xml', '.svg'
];

export interface FileValidationResult {
  isValid: boolean;
  fileType: 'image' | 'document' | 'video' | 'audio' | null;
  errors: string[];
  warnings: string[];
  detectedMimeType?: string;
  detectedExtension?: string;
}

/**
 * 파일 확장자 추출 및 검증
 */
export const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot).toLowerCase();
};

/**
 * 파일의 매직 바이트 검증
 */
export const validateMagicBytes = async (file: File, expectedSignatures: number[][]): Promise<boolean> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      
      // 각 시그니처와 매칭 확인
      for (const signature of expectedSignatures) {
        if (signature.length <= bytes.length) {
          let matches = true;
          for (let i = 0; i < signature.length; i++) {
            if (bytes[i] !== signature[i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            resolve(true);
            return;
          }
        }
      }
      resolve(false);
    };

    reader.onerror = () => resolve(false);
    
    // 처음 32바이트만 읽기 (매직 바이트 확인용)
    const slice = file.slice(0, 32);
    reader.readAsArrayBuffer(slice);
  });
};

/**
 * 종합적인 파일 검증
 */
export const validateFile = async (file: File): Promise<StrictFileValidationResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fileType: 'image' | 'document' | 'video' | 'audio' | null = null;
  let securityRisk: 'none' | 'low' | 'medium' | 'high' = 'none';

  // 1. 기본 파일 정보 검증
  if (!file || !file.name) {
    errors.push('유효하지 않은 파일입니다.');
    return { 
      isValid: false, 
      fileType: null, 
      errors: Object.freeze(errors), 
      warnings: Object.freeze(warnings),
      securityRisk: 'high'
    };
  }

  // 2. 파일 확장자 검증
  const extension = getFileExtension(file.name);
  const detectedExtension = extension;

  if (!extension) {
    errors.push('파일 확장자가 없습니다.');
    securityRisk = 'medium';
  }

  // 위험한 확장자 차단
  if (DANGEROUS_EXTENSIONS.includes(extension)) {
    errors.push(`위험한 파일 형식입니다: ${extension}`);
    return { 
      isValid: false, 
      fileType: null, 
      errors: Object.freeze(errors), 
      warnings: Object.freeze(warnings), 
      detectedExtension,
      securityRisk: 'high'
    };
  }

  // 3. MIME 타입 검증
  const mimeType = file.type;
  const detectedMimeType = mimeType;

  if (!mimeType) {
    warnings.push('MIME 타입이 감지되지 않았습니다.');
    securityRisk = Math.max(securityRisk === 'none' ? 0 : securityRisk === 'low' ? 1 : securityRisk === 'medium' ? 2 : 3, 1) === 1 ? 'low' : 
                securityRisk === 'medium' ? 'medium' : 'high';
  }

  // 4. 파일 타입 결정 및 검증
  for (const [type, signature] of Object.entries(FILE_SIGNATURES)) {
    const typeKey = type as keyof typeof FILE_SIGNATURES;
    
    // 확장자 매칭 확인
    const extensionMatch = signature.extensions.includes(extension);
    // MIME 타입 매칭 확인
    const mimeMatch = signature.mimeTypes.includes(mimeType);

    if (extensionMatch || mimeMatch) {
      fileType = typeKey as 'image' | 'document' | 'video' | 'audio';
      
      // 확장자와 MIME 타입이 일치하지 않는 경우 경고
      if (extensionMatch && !mimeMatch) {
        warnings.push(`파일 확장자(${extension})와 MIME 타입(${mimeType})이 일치하지 않습니다.`);
        securityRisk = Math.max(securityRisk === 'none' ? 0 : securityRisk === 'low' ? 1 : securityRisk === 'medium' ? 2 : 3, 2) === 2 ? 'medium' : 'high';
      }
      
      // 파일 크기 검증
      if (file.size > signature.maxSize) {
        errors.push(`파일이 너무 큽니다. 최대 크기: ${Math.round(signature.maxSize / 1024 / 1024)}MB`);
      }

      // 5. 매직 바이트 검증
      const magicBytesValid = await validateMagicBytes(file, signature.magicBytes);
      if (!magicBytesValid) {
        errors.push('파일 내용이 확장자와 일치하지 않습니다. (매직 바이트 불일치)');
        securityRisk = 'high';
      }

      break;
    }
  }

  // 지원하지 않는 파일 타입
  if (!fileType) {
    errors.push(`지원하지 않는 파일 형식입니다: ${extension} (${mimeType})`);
    securityRisk = 'medium';
  }

  return {
    isValid: errors.length === 0,
    fileType,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    detectedMimeType,
    detectedExtension,
    securityRisk
  } as const;
};;

/**
 * 파일명 보안 검증
 */
export const validateFileName = (filename: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // 파일명 길이 제한
  if (filename.length > 255) {
    errors.push('파일명이 너무 깁니다. (최대 255자)');
  }

  // 위험한 문자 차단
  const dangerousChars = /[<>:"|?*\x00-\x1f]/;
  if (dangerousChars.test(filename)) {
    errors.push('파일명에 허용되지 않는 문자가 포함되어 있습니다.');
  }

  // 예약된 파일명 차단 (Windows)
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  const nameWithoutExt = filename.split('.')[0].toUpperCase();
  if (reservedNames.includes(nameWithoutExt)) {
    errors.push('예약된 파일명입니다.');
  }

  // 숨김 파일 차단
  if (filename.startsWith('.')) {
    errors.push('숨김 파일은 업로드할 수 없습니다.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * 이미지 메타데이터 제거 (EXIF 등)
 * 클라이언트 사이드에서 실행
 */
export const sanitizeImageFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const sanitizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now()
            });
            resolve(sanitizedFile);
          } else {
            resolve(file); // 실패 시 원본 반환
          }
        }, file.type, 0.95);
      } else {
        resolve(file);
      }
    };

    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};