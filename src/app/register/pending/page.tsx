'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase/client';

export default function PendingPage() {
  const [userEmail, setUserEmail] = useState<string>('');
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    // 현재 사용자 정보 가져오기
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || '');
      }
    };
    
    getCurrentUser();
  }, []);

  const checkApprovalStatus = async () => {
    setCheckingStatus(true);
    setLastChecked(new Date());
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      const { data: profile, error } = await supabase
        .from('member_profiles')
        .select('registration_status, is_active')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('프로필 확인 오류:', error);
        alert('상태 확인 중 오류가 발생했습니다.');
        return;
      }

      if (profile?.registration_status === 'approved' && profile?.is_active) {
        alert('🎉 축하합니다! 조합원 승인이 완료되었습니다. 게시판으로 이동합니다.');
        window.location.href = '/board';
      } else if (profile?.registration_status === 'rejected') {
        alert('😔 죄송합니다. 가입 신청이 거절되었습니다. 자세한 사항은 관리자에게 문의해주세요.');
      } else {
        alert('아직 승인 대기 중입니다. 조금 더 기다려주세요.');
      }
    } catch (error) {
      console.error('상태 확인 오류:', error);
      alert('상태 확인 중 오류가 발생했습니다.');
    } finally {
      setCheckingStatus(false);
    }
  };

  const formatLastChecked = (date: Date) => {
    return date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-24 md:pt-28 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="max-w-lg w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-yellow-100 mb-4">
            <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900">
            승인 대기 중
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            조합원 정보가 성공적으로 제출되었습니다.
          </p>
          {userEmail && (
            <p className="mt-1 text-xs text-gray-500">
              등록 이메일: {userEmail}
            </p>
          )}
        </div>
        
        <div className="space-y-4">
          <div className="p-4 rounded-md bg-blue-50 border border-blue-200">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 text-blue-700">
                <h3 className="text-sm font-medium">현재 상태</h3>
                <div className="mt-2 text-sm">
                  <p>✅ 조합원 가입 완료</p>
                  <p>⏳ 관리자 승인 대기 중</p>
                  <p>🎯 승인 완료 시 이메일 알림 및 게시판 접근 가능</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-md bg-green-50 border border-green-200">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 text-green-700">
                <h3 className="text-sm font-medium">승인 완료 후</h3>
                <div className="mt-2 text-sm">
                  <p>• 조합원 게시판 이용 가능</p>
                  <p>• 공지사항, 잡담, 홍보, 건의 게시글 작성/댓글</p>
                  <p>• 조합원 전용 정보 및 활동 참여</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-3">
          <button
            onClick={checkApprovalStatus}
            disabled={checkingStatus}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingStatus ? '확인 중...' : '승인 상태 확인하기'}
          </button>
          
          {lastChecked && (
            <p className="text-xs text-gray-500 text-center">
              마지막 확인: {formatLastChecked(lastChecked)}
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 pt-6">
          <div className="text-center text-sm text-gray-600">
            <p className="mb-2">궁금한 점이 있으시면:</p>
            <div className="space-x-4">
              <Link href="/connect" className="font-medium text-primary-600 hover:text-primary-500">
                문의하기
              </Link>
              <span className="text-gray-300">|</span>
              <Link href="/" className="font-medium text-primary-600 hover:text-primary-500">
                홈으로 돌아가기
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
