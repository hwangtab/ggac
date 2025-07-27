/**
 * 빌드 성능 추적 시스템
 * 번들 크기, 빌드 시간, 메모리 사용량 등을 모니터링
 */

import { promises as fs } from 'fs';
import { join } from 'path';

// 성능 메트릭 인터페이스
interface BuildMetrics {
  buildId: string;
  timestamp: string;
  environment: 'development' | 'production';
  duration: number; // milliseconds
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  bundleStats: {
    totalSize: number;
    gzippedSize?: number;
    chunkCount: number;
    largestChunks: Array<{
      name: string;
      size: number;
      type: 'js' | 'css' | 'other';
    }>;
  };
  dependencies: {
    total: number;
    production: number;
    development: number;
  };
  warnings: string[];
  errors: string[];
}

// 성능 추적기 클래스
class BuildPerformanceTracker {
  private startTime: number = 0;
  private metrics: Partial<BuildMetrics> = {};
  private metricsPath: string;

  constructor() {
    this.metricsPath = join(process.cwd(), '.next', 'build-metrics.json');
  }

  // 빌드 시작 추적
  startTracking(buildId: string, environment: 'development' | 'production') {
    this.startTime = Date.now();
    this.metrics = {
      buildId,
      timestamp: new Date().toISOString(),
      environment,
      warnings: [],
      errors: [],
    };

    console.log(`🚀 Build tracking started for ${environment} (ID: ${buildId})`);
  }

  // 메모리 사용량 추적
  trackMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    this.metrics.memoryUsage = {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
    };
  }

  // 의존성 정보 추적
  async trackDependencies() {
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const productionDeps = Object.keys(packageJson.dependencies || {}).length;
      const developmentDeps = Object.keys(packageJson.devDependencies || {}).length;
      
      this.metrics.dependencies = {
        total: productionDeps + developmentDeps,
        production: productionDeps,
        development: developmentDeps,
      };
    } catch (error) {
      console.warn('Failed to track dependencies:', error);
    }
  }

  // 번들 통계 추적
  async trackBundleStats() {
    try {
      const nextDir = join(process.cwd(), '.next');
      const buildManifestPath = join(nextDir, 'build-manifest.json');
      
      if (await this.fileExists(buildManifestPath)) {
        const buildManifest = JSON.parse(await fs.readFile(buildManifestPath, 'utf-8'));
        const staticDir = join(nextDir, 'static');
        
        let totalSize = 0;
        let chunkCount = 0;
        const largestChunks: Array<{ name: string; size: number; type: 'js' | 'css' | 'other' }> = [];

        // JavaScript 청크 분석
        if (buildManifest.pages) {
          for (const [page, chunks] of Object.entries(buildManifest.pages)) {
            if (Array.isArray(chunks)) {
              for (const chunk of chunks) {
                try {
                  const chunkPath = join(staticDir, chunk);
                  if (await this.fileExists(chunkPath)) {
                    const stat = await fs.stat(chunkPath);
                    totalSize += stat.size;
                    chunkCount++;
                    
                    largestChunks.push({
                      name: chunk,
                      size: stat.size,
                      type: chunk.endsWith('.css') ? 'css' : 'js'
                    });
                  }
                } catch (error) {
                  // 파일이 없거나 접근할 수 없는 경우 무시
                }
              }
            }
          }
        }

        // 크기 순으로 정렬하고 상위 10개만 유지
        largestChunks.sort((a, b) => b.size - a.size);
        largestChunks.splice(10);

        this.metrics.bundleStats = {
          totalSize: Math.round(totalSize / 1024), // KB
          chunkCount,
          largestChunks: largestChunks.map(chunk => ({
            ...chunk,
            size: Math.round(chunk.size / 1024) // KB
          }))
        };
      }
    } catch (error) {
      console.warn('Failed to track bundle stats:', error);
      this.metrics.bundleStats = {
        totalSize: 0,
        chunkCount: 0,
        largestChunks: []
      };
    }
  }

  // 경고 및 에러 추가
  addWarning(warning: string) {
    this.metrics.warnings?.push(warning);
  }

  addError(error: string) {
    this.metrics.errors?.push(error);
  }

  // 빌드 완료 및 메트릭 저장
  async finishTracking() {
    this.metrics.duration = Date.now() - this.startTime;
    
    // 최종 메모리 사용량 및 번들 통계 수집
    this.trackMemoryUsage();
    await this.trackDependencies();
    await this.trackBundleStats();

    // 메트릭 저장
    await this.saveMetrics();
    
    // 결과 출력
    this.printSummary();
  }

  // 메트릭 저장
  private async saveMetrics() {
    try {
      const nextDir = join(process.cwd(), '.next');
      await fs.mkdir(nextDir, { recursive: true });
      
      // 기존 메트릭 로드 (히스토리 유지)
      let allMetrics: BuildMetrics[] = [];
      try {
        const existingData = await fs.readFile(this.metricsPath, 'utf-8');
        allMetrics = JSON.parse(existingData);
      } catch {
        // 파일이 없거나 파싱 실패 시 빈 배열로 시작
      }

      // 새 메트릭 추가 (최대 50개 유지)
      allMetrics.push(this.metrics as BuildMetrics);
      allMetrics = allMetrics.slice(-50);

      await fs.writeFile(this.metricsPath, JSON.stringify(allMetrics, null, 2));
    } catch (error) {
      console.warn('Failed to save build metrics:', error);
    }
  }

  // 빌드 요약 출력
  private printSummary() {
    const { duration, memoryUsage, bundleStats, dependencies, warnings, errors } = this.metrics;
    
    console.log('\n📊 Build Performance Summary');
    console.log('═'.repeat(50));
    
    if (duration) {
      console.log(`⏱️  Build Duration: ${this.formatDuration(duration)}`);
    }
    
    if (memoryUsage) {
      console.log(`💾 Memory Usage: ${memoryUsage.heapUsed}MB (Peak: ${memoryUsage.rss}MB)`);
    }
    
    if (bundleStats) {
      console.log(`📦 Bundle Size: ${bundleStats.totalSize}KB (${bundleStats.chunkCount} chunks)`);
      
      if (bundleStats.largestChunks.length > 0) {
        console.log('📈 Largest Chunks:');
        bundleStats.largestChunks.slice(0, 5).forEach((chunk, index) => {
          console.log(`   ${index + 1}. ${chunk.name} (${chunk.size}KB)`);
        });
      }
    }
    
    if (dependencies) {
      console.log(`📚 Dependencies: ${dependencies.total} total (${dependencies.production} prod, ${dependencies.development} dev)`);
    }
    
    if (warnings && warnings.length > 0) {
      console.log(`⚠️  Warnings: ${warnings.length}`);
    }
    
    if (errors && errors.length > 0) {
      console.log(`❌ Errors: ${errors.length}`);
    }
    
    console.log('═'.repeat(50));
    
    // 성능 경고
    this.checkPerformanceWarnings();
  }

  // 성능 경고 체크
  private checkPerformanceWarnings() {
    const { duration, memoryUsage, bundleStats } = this.metrics;
    const warnings: string[] = [];

    if (duration && duration > 60000) { // 1분 이상
      warnings.push(`⚠️  Build duration is high (${this.formatDuration(duration)})`);
    }

    if (memoryUsage && memoryUsage.heapUsed > 1000) { // 1GB 이상
      warnings.push(`⚠️  High memory usage (${memoryUsage.heapUsed}MB)`);
    }

    if (bundleStats && bundleStats.totalSize > 5000) { // 5MB 이상
      warnings.push(`⚠️  Large bundle size (${bundleStats.totalSize}KB)`);
    }

    if (bundleStats && bundleStats.largestChunks.some(chunk => chunk.size > 1000)) { // 1MB 이상 청크
      warnings.push(`⚠️  Large chunks detected (>1MB)`);
    }

    if (warnings.length > 0) {
      console.log('\n🚨 Performance Warnings:');
      warnings.forEach(warning => console.log(warning));
    }
  }

  // 메트릭 히스토리 조회
  async getMetricsHistory(): Promise<BuildMetrics[]> {
    try {
      const data = await fs.readFile(this.metricsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  // 성능 트렌드 분석
  async analyzePerformanceTrends(): Promise<{
    averageBuildTime: number;
    bundleSizeTrend: 'increasing' | 'decreasing' | 'stable';
    memoryUsageTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    const history = await this.getMetricsHistory();
    
    if (history.length < 5) {
      return {
        averageBuildTime: 0,
        bundleSizeTrend: 'stable',
        memoryUsageTrend: 'stable'
      };
    }

    // 최근 10개 빌드 분석
    const recent = history.slice(-10);
    const averageBuildTime = recent.reduce((sum, m) => sum + m.duration, 0) / recent.length;
    
    // 트렌드 분석 (최근 5개 vs 이전 5개)
    const older = recent.slice(0, 5);
    const newer = recent.slice(-5);
    
    const olderBundleSize = older.reduce((sum, m) => sum + m.bundleStats.totalSize, 0) / older.length;
    const newerBundleSize = newer.reduce((sum, m) => sum + m.bundleStats.totalSize, 0) / newer.length;
    
    const olderMemoryUsage = older.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / older.length;
    const newerMemoryUsage = newer.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / newer.length;
    
    const bundleSizeTrend = this.getTrend(olderBundleSize, newerBundleSize);
    const memoryUsageTrend = this.getTrend(olderMemoryUsage, newerMemoryUsage);
    
    return {
      averageBuildTime: Math.round(averageBuildTime),
      bundleSizeTrend,
      memoryUsageTrend
    };
  }

  // 유틸리티 메서드들
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private getTrend(older: number, newer: number): 'increasing' | 'decreasing' | 'stable' {
    const change = (newer - older) / older;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }
}

// Webpack 플러그인으로 사용할 수 있는 클래스
class BuildPerformancePlugin {
  private tracker: BuildPerformanceTracker;

  constructor() {
    this.tracker = new BuildPerformanceTracker();
  }

  apply(compiler: any) {
    const buildId = process.env.BUILD_ID || 'unknown';
    const environment = process.env.NODE_ENV as 'development' | 'production';

    compiler.hooks.run.tap('BuildPerformancePlugin', () => {
      this.tracker.startTracking(buildId, environment);
    });

    compiler.hooks.watchRun.tap('BuildPerformancePlugin', () => {
      this.tracker.startTracking(buildId, environment);
    });

    compiler.hooks.done.tapAsync('BuildPerformancePlugin', (stats: any, callback: () => void) => {
      // 경고 및 에러 수집
      if (stats.compilation.warnings) {
        stats.compilation.warnings.forEach((warning: any) => {
          this.tracker.addWarning(warning.message || warning.toString());
        });
      }

      if (stats.compilation.errors) {
        stats.compilation.errors.forEach((error: any) => {
          this.tracker.addError(error.message || error.toString());
        });
      }

      // 추적 완료
      this.tracker.finishTracking().finally(callback);
    });
  }
}

// 전역 인스턴스
const buildPerformanceTracker = new BuildPerformanceTracker();

export {
  BuildPerformanceTracker,
  BuildPerformancePlugin,
  buildPerformanceTracker,
  type BuildMetrics
};

export default buildPerformanceTracker;