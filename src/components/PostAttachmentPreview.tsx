'use client';

import React, { useState, useEffect } from 'react';
import { FiImage, FiFile, FiVideo, FiMusic } from 'react-icons/fi';

interface PostAttachmentPreviewProps {
  postId: string;
  className?: string;
}

interface AttachmentStats {
  total_attachments: number;
  image_count: number;
  document_count: number;
  video_count: number;
  audio_count: number;
}

const PostAttachmentPreview: React.FC<PostAttachmentPreviewProps> = ({
  postId,
  className = ''
}) => {
  const [stats, setStats] = useState<AttachmentStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttachmentStats = async () => {
      try {
        const response = await fetch(`/api/posts/${postId}/attachments`);
        if (response.ok) {
          const data = await response.json();
          setStats(data.stats);
        }
      } catch (error) {
        console.error('첨부파일 정보 조회 실패:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAttachmentStats();
  }, [postId]);

  if (loading || !stats || stats.total_attachments === 0) {
    return null;
  }

  return (
    <div className={`flex items-center space-x-2 text-xs text-gray-500 ${className}`}>
      {stats.image_count > 0 && (
        <div className="flex items-center">
          <FiImage className="w-3 h-3 mr-1" />
          <span>{stats.image_count}</span>
        </div>
      )}
      {stats.document_count > 0 && (
        <div className="flex items-center">
          <FiFile className="w-3 h-3 mr-1" />
          <span>{stats.document_count}</span>
        </div>
      )}
      {stats.video_count > 0 && (
        <div className="flex items-center">
          <FiVideo className="w-3 h-3 mr-1" />
          <span>{stats.video_count}</span>
        </div>
      )}
      {stats.audio_count > 0 && (
        <div className="flex items-center">
          <FiMusic className="w-3 h-3 mr-1" />
          <span>{stats.audio_count}</span>
        </div>
      )}
    </div>
  );
};

export default PostAttachmentPreview;