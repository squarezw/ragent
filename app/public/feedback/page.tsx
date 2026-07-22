'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import axios from '@/lib/axios';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, MessageSquare, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * 反馈落地页 - 处理 query string 格式的 URL
 * URL: /feedback?t=...&a=good 或 /feedback?t=...&a=bad
 * t 包含加密的 detail_id 和 user_id（由后端生成和验证）
 */
export default function FeedbackPage() {
  const searchParams = useSearchParams();
  const t = useTranslations('feedback');

  // 从 query string 获取参数
  const token = searchParams?.get('t') || '';
  const actionParam = (searchParams?.get('a')) as 'good' | 'bad' | null;

  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error' | 'already_submitted'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [action, setAction] = useState<'good' | 'bad' | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 从 URL 获取参数并初始化
  useEffect(() => {
    if (!token) {
      setSubmitStatus('error');
      setErrorMessage(t('missingToken'));
      setIsLoading(false);
      return;
    }

    if (!actionParam || (actionParam !== 'good' && actionParam !== 'bad')) {
      setSubmitStatus('error');
      setErrorMessage(t('invalidAction'));
      setIsLoading(false);
      return;
    }

    setAction(actionParam);
    setIsLoading(false);

    // 如果是 good，自动提交
    if (actionParam === 'good') {
      handleSubmit('good');
    }
  }, [token, actionParam, t]);

  const handleSubmit = async (submitAction?: 'good' | 'bad') => {
    setIsSubmitting(true);
    setErrorMessage('');

    const currentAction = submitAction || action;

    try {
      const response = await axios.post('/api/public/feedback', {
        t: token,
        a: currentAction,
        content: currentAction === 'bad' ? feedback : null,
      });

      if (response.data.success) {
        setSubmitStatus('success');
      }
    } catch (error: any) {
      console.error('提交反馈失败:', error);

      // 根据 HTTP 状态码判断错误类型
      if (error.response?.status === 409) {
        setSubmitStatus('already_submitted');
        setErrorMessage(error.response.data?.details || t('alreadySubmitted'));
      } else {
        setSubmitStatus('error');
        setErrorMessage(error.response?.data?.details || error.response?.data?.error || t('submitFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBadSubmit = () => {
    if (!feedback.trim()) {
      setErrorMessage(t('feedbackRequired'));
      return;
    }
    handleSubmit('bad');
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="pt-12 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('loading')}
            </h2>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 成功页面
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="pt-12 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-12 h-12 text-green-700" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('thankYou')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {action === 'good'
                ? t('satisfiedMessage')
                : t('improveMessage')
              }
            </p>
            <div className="text-sm text-muted-foreground">
              {t('canClose')}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 已提交过反馈
  if (submitStatus === 'already_submitted') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="pt-12 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center">
                <MessageSquare className="w-12 h-12 text-yellow-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('alreadySubmittedTitle')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {errorMessage}
            </p>
            <div className="text-sm text-muted-foreground">
              {t('canClose')}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 错误页面
  if (submitStatus === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="pt-12 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                <XCircle className="w-12 h-12 text-destructive" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('errorTitle')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {errorMessage || t('tryAgain')}
            </p>
            {action === 'bad' && (
              <Button
                onClick={handleBadSubmit}
                className="mt-4"
              >
                {t('retry')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Good 反馈 - 加载中
  if (action === 'good') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardContent className="pt-12 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t('submittingFeedback')}
            </h2>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Bad 反馈 - 输入表单
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-orange-600" />
            </div>
          </div>
          <CardTitle className="text-2xl">{t('sorryTitle')}</CardTitle>
          <CardDescription className="text-base mt-2">
            {t('sorryDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="feedback" className="text-sm font-medium text-foreground">
              {t('feedbackLabel')} <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="feedback"
              placeholder={t('feedbackPlaceholder')}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={6}
              className="resize-none"
              disabled={isSubmitting}
            />
          </div>

          {errorMessage && (
            <div className="text-sm text-destructive bg-red-50 p-3 rounded-md">
              {errorMessage}
            </div>
          )}

          <Button
            onClick={handleBadSubmit}
            disabled={isSubmitting || !feedback.trim()}
            className="w-full"
            size="lg"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('submitting')}
              </>
            ) : (
              t('submitFeedback')
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            {t('cannotModify')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
