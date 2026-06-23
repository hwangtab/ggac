import { existsSync, readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const nextConfigPath = join(root, 'next.config.js')
const nextConfigSource = readFileSync(nextConfigPath, 'utf8')
const appFiles = globSync('src/app/**/{route,page,layout}.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})

const edgeRuntimeFiles = appFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(source)
})

const middlewareFiles = globSync('src/middleware{.ts,/**/*.ts}', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})
const middlewareSupabaseImports = middlewareFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /from\s+['"]@supabase\//.test(source)
})
const authMiddlewarePath = join(root, 'src/middleware/auth.ts')
const authMiddlewareSource = readFileSync(authMiddlewarePath, 'utf8')
const rootMiddlewarePath = join(root, 'src/middleware.ts')
const rootMiddlewareSource = readFileSync(rootMiddlewarePath, 'utf8')
const authCallbackPath = join(root, 'src/app/auth/callback/route.ts')
const authCallbackSource = readFileSync(authCallbackPath, 'utf8')
const authVerifySessionPath = join(root, 'src/app/api/auth/verify-session/route.ts')
const authVerifySessionSource = readFileSync(authVerifySessionPath, 'utf8')
const securityPath = join(root, 'src/utils/security.ts')
const securitySource = readFileSync(securityPath, 'utf8')
const signupPagePath = join(root, 'src/app/[locale]/signup/page.tsx')
const signupPageSource = readFileSync(signupPagePath, 'utf8')
const forgotPasswordPagePath = join(root, 'src/app/[locale]/forgot-password/page.tsx')
const forgotPasswordPageSource = readFileSync(forgotPasswordPagePath, 'utf8')
const resetPasswordPagePath = join(root, 'src/app/[locale]/reset-password/page.tsx')
const resetPasswordPageSource = readFileSync(resetPasswordPagePath, 'utf8')
const authResetPasswordApiPath = join(root, 'src/app/api/auth/reset-password/route.ts')
const authResetPasswordApiSource = existsSync(authResetPasswordApiPath)
  ? readFileSync(authResetPasswordApiPath, 'utf8')
  : ''
const loginPagePath = join(root, 'src/app/[locale]/login/page.tsx')
const loginPageSource = readFileSync(loginPagePath, 'utf8')
const authRegisterPendingPagePath = join(root, 'src/app/[locale]/register/pending/page.tsx')
const authRegisterPendingPageSource = readFileSync(authRegisterPendingPagePath, 'utf8')
const authMypageArtistPagePath = join(root, 'src/app/[locale]/mypage/artist/page.tsx')
const authMypageArtistPageSource = readFileSync(authMypageArtistPagePath, 'utf8')
const postsApiPath = join(root, 'src/app/api/posts/route.ts')
const postsApiSource = readFileSync(postsApiPath, 'utf8')
const postDetailApiPath = join(root, 'src/app/api/posts/[id]/route.ts')
const postDetailApiSource = readFileSync(postDetailApiPath, 'utf8')
const usePostCreationPath = join(root, 'src/hooks/usePostCreation.ts')
const usePostCreationSource = readFileSync(usePostCreationPath, 'utf8')
const writePageClientPath = join(root, 'src/app/[locale]/board/write/WritePageClient.tsx')
const writePageClientSource = readFileSync(writePageClientPath, 'utf8')
const editPageClientPath = join(root, 'src/app/[locale]/board/[id]/edit/EditPageClient.tsx')
const editPageClientSource = readFileSync(editPageClientPath, 'utf8')
const mypageProfilePagePath = join(root, 'src/app/[locale]/mypage/profile/page.tsx')
const mypageProfilePageSource = readFileSync(mypageProfilePagePath, 'utf8')
const mypageProfileApiPath = join(root, 'src/app/api/mypage/profile/route.ts')
const mypageProfileApiSource = existsSync(mypageProfileApiPath)
  ? readFileSync(mypageProfileApiPath, 'utf8')
  : ''
const useCommentLikesPath = join(root, 'src/hooks/useCommentLikes.ts')
const useCommentLikesSource = readFileSync(useCommentLikesPath, 'utf8')
const usePostLikesPath = join(root, 'src/hooks/usePostLikes.ts')
const usePostLikesSource = readFileSync(usePostLikesPath, 'utf8')
const activityLoggerEarlyPath = join(root, 'src/utils/activityLogger.ts')
const activityLoggerEarlySource = readFileSync(activityLoggerEarlyPath, 'utf8')
const mypagePermissionCheckPath = join(
  root,
  'src/app/[locale]/mypage/components/PermissionCheck.tsx'
)
const mypagePermissionCheckSource = readFileSync(mypagePermissionCheckPath, 'utf8')
const mypageNavigationPath = join(root, 'src/app/[locale]/mypage/components/MypageNavigation.tsx')
const mypageNavigationSource = readFileSync(mypageNavigationPath, 'utf8')
const boardUserSectionPath = join(root, 'src/components/board/BoardUserSection.tsx')
const boardUserSectionSource = readFileSync(boardUserSectionPath, 'utf8')
const navigationPath = join(root, 'src/components/Navigation.tsx')
const navigationSource = readFileSync(navigationPath, 'utf8')
const boardRoomClientPagePaths = [
  'src/app/[locale]/board-room/page.tsx',
  'src/app/[locale]/board-room/documents/page.tsx',
  'src/app/[locale]/board-room/schedule/page.tsx',
  'src/app/[locale]/board-room/assembly/page.tsx',
  'src/app/[locale]/board-room/meetings/page.tsx',
  'src/app/[locale]/board-room/meetings/new/page.tsx',
  'src/app/[locale]/board-room/meetings/[id]/page.tsx',
  'src/app/[locale]/board-room/meetings/[id]/edit/page.tsx',
]
const boardRoomClientPageSources = boardRoomClientPagePaths.map(routePath => ({
  path: join(root, routePath),
  source: readFileSync(join(root, routePath), 'utf8'),
}))
const middlewarePreservesProtectedLoginRedirects =
  /stripLocalePrefix/.test(authMiddlewareSource) &&
  /getLocaleRedirectPath/.test(authMiddlewareSource) &&
  /redirectToPath/.test(authMiddlewareSource) &&
  /const\s+authPathname\s*=\s*stripLocalePrefix\(pathname\)/.test(authMiddlewareSource) &&
  /redirectToLogin/.test(authMiddlewareSource) &&
  /new URL\(getLocaleRedirectPath\(request,\s*['"]\/login['"]\),\s*request\.nextUrl\.origin\)/.test(
    authMiddlewareSource
  ) &&
  /url\.searchParams\.set\(['"]redirect['"],\s*requestedPath\)/.test(authMiddlewareSource) &&
  !/NextResponse\.redirect\(new URL\(['"]\/login['"],\s*request\.nextUrl\.origin\)\)/.test(
    authMiddlewareSource
  )
const middlewareProtectsOnlyValidBoardEditIds =
  /UUID_PATH_SEGMENT_REGEX/.test(authMiddlewareSource) &&
  /BOARD_EDIT_PATH_REGEX/.test(authMiddlewareSource) &&
  /const boardEditMatch = authPathname\.match\(BOARD_EDIT_PATH_REGEX\)/.test(
    authMiddlewareSource
  ) &&
  /const isBoardEdit = Boolean\(boardEditMatch && UUID_PATH_SEGMENT_REGEX\.test\(boardEditMatch\[1\]\)\)/.test(
    authMiddlewareSource
  ) &&
  !/const isBoardEdit = \/\\\/board\\\/\.\+\\\/edit\$\/\.test\(authPathname\)/.test(
    authMiddlewareSource
  )
const registrationPageBlockSource =
  authMiddlewareSource.match(/if \(isRegistrationPage\) \{[\s\S]*?\n\s{2}\}/)?.[0] ?? ''
const middlewareRedirectsApprovedRegistrationPagesToBoard =
  /userStatus === ['"]approved['"][\s\S]*?isActive[\s\S]*?redirectToPath\(request,\s*['"]\/board['"]\)/.test(
    registrationPageBlockSource
  ) &&
  !/const\s+expectedPath\s*=\s*`\/register\/\$\{userStatus\}`/.test(registrationPageBlockSource) &&
  !/NextResponse\.redirect\(new URL\(['"]\/(?:board|register\/pending|register\/rejected)['"],\s*request\.nextUrl\.origin\)\)/.test(
    authMiddlewareSource
  )
const authCallbackParsesMonthlyFeeSafely =
  /parseOptionalMonthlyFee/.test(authCallbackSource) &&
  /Number\.isFinite/.test(authCallbackSource) &&
  /monthly_fee:\s*parseOptionalMonthlyFee\(user\.user_metadata\?\.monthly_fee\)/.test(
    authCallbackSource
  ) &&
  !/monthly_fee:\s*user\.user_metadata\?\.monthly_fee[\s\S]*?parseInt/.test(authCallbackSource)
const authCallbackPreservesEmailFlowLocale =
  /resolveSafeLocale/.test(authCallbackSource) &&
  /localizePath/.test(authCallbackSource) &&
  /ALLOWED_NEXT_PATHS:\s*readonly\s*string\[\]\s*=\s*\[['"]\/reset-password['"]\]/.test(
    authCallbackSource
  ) &&
  /redirectToPath\(requestUrl,\s*safeNext,\s*locale\)/.test(authCallbackSource) &&
  /redirectToPath\(requestUrl,\s*['"]\/register\/pending['"],\s*locale\)/.test(
    authCallbackSource
  ) &&
  /redirectToPath\(requestUrl,\s*['"]\/board['"],\s*locale\)/.test(authCallbackSource) &&
  /callbackUrl\.searchParams\.set\(['"]locale['"],\s*locale\)/.test(signupPageSource) &&
  /emailRedirectTo:\s*callbackUrl\.toString\(\)/.test(signupPageSource) &&
  /callbackUrl\.searchParams\.set\(['"]locale['"],\s*locale\)/.test(forgotPasswordPageSource) &&
  /callbackUrl\.searchParams\.set\(['"]next['"],\s*['"]\/reset-password['"]\)/.test(
    forgotPasswordPageSource
  ) &&
  /resetPasswordForEmail\(email,\s*\{\s*redirectTo\s*\}\)/.test(forgotPasswordPageSource) &&
  !/NextResponse\.redirect\(`\$\{requestUrl\.origin\}\/(?:login|register\/pending|register\/rejected|board|reset-password)`\)/.test(
    authCallbackSource
  )
const postCreationUsesServerApi =
  /fetch\(['"]\/api\/posts['"]/.test(usePostCreationSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(usePostCreationSource) &&
  !/from\(['"]posts['"]\)[\s\S]*?\.insert/.test(usePostCreationSource)
const boardPostCreationAvoidsRefreshQuery =
  /router\.push\(['"]\/board['"]\)/.test(writePageClientSource) &&
  /router\.refresh\(\)/.test(writePageClientSource) &&
  !/refresh=\$\{Date\.now\(\)\}/.test(writePageClientSource) &&
  !/\/board\?refresh=/.test(writePageClientSource)
const postsApiCreatesPostsWithServerAuthAndInvalidatesBoard =
  /export async function POST/.test(postsApiSource) &&
  /parseJsonObjectBody/.test(postsApiSource) &&
  /parseBoardCategory/.test(postsApiSource) &&
  /registration_status/.test(postsApiSource) &&
  /is_active/.test(postsApiSource) &&
  /author_id:\s*user\.id/.test(postsApiSource) &&
  /revalidatePath\(['"]\/board['"]\)/.test(postsApiSource) &&
  /revalidateTag\(['"]board-post['"]\)/.test(postsApiSource) &&
  /revalidateTag\(['"]board-initial['"]\)/.test(postsApiSource)
const postEditUsesServerApi =
  /fetch\(`\/api\/posts\/\$\{post\.id\}`/.test(editPageClientSource) &&
  /method:\s*['"]PATCH['"]/.test(editPageClientSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(editPageClientSource) &&
  !/from\(['"]posts['"]\)[\s\S]*?\.update/.test(editPageClientSource)
const postsApiUpdatesPostsWithServerAuthAndInvalidatesBoard =
  /export async function PATCH/.test(postDetailApiSource) &&
  /parseJsonObjectBody/.test(postDetailApiSource) &&
  /parseBoardCategory/.test(postDetailApiSource) &&
  /registration_status/.test(postDetailApiSource) &&
  /is_active/.test(postDetailApiSource) &&
  /post\.author_id !== user\.id && !isAdmin/.test(postDetailApiSource) &&
  /revalidateTag\(`post-\$\{validPostId\}`\)/.test(postDetailApiSource) &&
  /revalidateTag\(['"]board-post['"]\)/.test(postDetailApiSource) &&
  /revalidateTag\(['"]board-initial['"]\)/.test(postDetailApiSource)
const profilePageUsesServerApi =
  /fetch\(['"]\/api\/mypage\/profile['"]/.test(mypageProfilePageSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(mypageProfilePageSource) &&
  !/from\(['"]member_profiles['"]\)[\s\S]*?\.update/.test(mypageProfilePageSource)
const profileApiRestrictsSelfUpdates =
  /export async function GET/.test(mypageProfileApiSource) &&
  /export async function PATCH/.test(mypageProfileApiSource) &&
  /parseJsonObjectBody/.test(mypageProfileApiSource) &&
  /registration_status/.test(mypageProfileApiSource) &&
  /is_active/.test(mypageProfileApiSource) &&
  /\.eq\(['"]id['"],\s*user\.id\)/.test(mypageProfileApiSource) &&
  /const updateData/.test(mypageProfileApiSource) &&
  !/is_admin/.test(mypageProfileApiSource) &&
  !/registration_status:\s*body/.test(mypageProfileApiSource) &&
  !/is_active:\s*body/.test(mypageProfileApiSource)
const commentLikesAvoidBearerTokenForwarding =
  /fetch\(`\/api\/comments\/\$\{commentId\}\/like`/.test(useCommentLikesSource) &&
  !/access_token/.test(useCommentLikesSource) &&
  !/Authorization:\s*`Bearer/.test(useCommentLikesSource)
const likeHooksUseServerSessionTruth =
  /fetchSessionProfile/.test(useCommentLikesSource) &&
  /fetchSessionProfile/.test(usePostLikesSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(useCommentLikesSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(usePostLikesSource) &&
  !/getSupabaseClient/.test(useCommentLikesSource) &&
  !/getSupabaseClient/.test(usePostLikesSource) &&
  !/getSession\(\)/.test(useCommentLikesSource) &&
  !/getSession\(\)/.test(usePostLikesSource) &&
  !/onAuthStateChange/.test(useCommentLikesSource) &&
  !/onAuthStateChange/.test(usePostLikesSource)
const activityLoggerAvoidsBearerTokenForwarding =
  /fetchSessionProfile/.test(activityLoggerEarlySource) &&
  /ensureSession/.test(activityLoggerEarlySource) &&
  /credentials:\s*['"]include['"]/.test(activityLoggerEarlySource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(activityLoggerEarlySource) &&
  !/onAuthStateChange/.test(activityLoggerEarlySource) &&
  !/getSession\(\)/.test(activityLoggerEarlySource) &&
  !/session\.access_token/.test(activityLoggerEarlySource) &&
  !/Authorization:\s*`Bearer/.test(activityLoggerEarlySource) &&
  !/sessionToken:\s*string\s*\|\s*null/.test(activityLoggerEarlySource)
const mypagePermissionUsesServerSessionTruth =
  /fetch\(['"]\/api\/auth\/verify-session['"]/.test(mypagePermissionCheckSource) &&
  /fetch\(['"]\/api\/auth\/verify-session['"]/.test(mypageNavigationSource) &&
  /is_admin/.test(authVerifySessionSource) &&
  /is_artist/.test(authVerifySessionSource) &&
  /artist_id/.test(authVerifySessionSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(mypagePermissionCheckSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(mypageNavigationSource) &&
  !/from\(['"]member_profiles['"]\)/.test(mypagePermissionCheckSource) &&
  !/from\(['"]member_profiles['"]\)/.test(mypageNavigationSource)
const boardUserSectionUsesServerSessionTruth =
  /fetch\(['"]\/api\/auth\/verify-session['"]/.test(boardUserSectionSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(boardUserSectionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(boardUserSectionSource) &&
  !/getSession\(\)/.test(boardUserSectionSource) &&
  !/onAuthStateChange/.test(boardUserSectionSource)
const navigationUsesServerSessionTruth =
  /fetchSessionProfile/.test(navigationSource) &&
  /is_director/.test(authVerifySessionSource) &&
  /is_auditor/.test(authVerifySessionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(navigationSource) &&
  !/import\(['"]@\/lib\/supabase\/client['"]\)/.test(navigationSource) &&
  !/getSession\(\)/.test(navigationSource) &&
  !/onAuthStateChange/.test(navigationSource)
const verifySessionTreatsMissingSessionAsNormal =
  /isMissingSessionError/.test(authVerifySessionSource) &&
  /AuthSessionMissingError/.test(authVerifySessionSource) &&
  /log\.debug\(['"]No session found['"]\)/.test(authVerifySessionSource) &&
  !/console\.error\(['"]\[VERIFY-SESSION\] Session error:/.test(authVerifySessionSource)
const authClientPagesUseServerSessionTruth =
  /fetchSessionProfile/.test(loginPageSource) &&
  /fetchSessionProfile/.test(authRegisterPendingPageSource) &&
  /fetch\(['"]\/api\/mypage\/artist['"]/.test(authMypageArtistPageSource) &&
  /email_confirmed_at/.test(authVerifySessionSource) &&
  !/from\(['"]member_profiles['"]\)/.test(loginPageSource) &&
  !/from\(['"]member_profiles['"]\)/.test(authRegisterPendingPageSource) &&
  !/getSession\(\)/.test(loginPageSource) &&
  !/getSession\(\)/.test(authRegisterPendingPageSource) &&
  !/getSession\(\)/.test(authMypageArtistPageSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(authMypageArtistPageSource)
const loginPageCleansAuthRedirectTimers =
  /useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(loginPageSource) &&
  /const clearAuthRedirectTimer/.test(loginPageSource) &&
  /clearTimeout\(authRedirectTimerRef\.current\)/.test(loginPageSource) &&
  /authRedirectTimerRef\.current = null/.test(loginPageSource) &&
  /useEffect\(\(\) => \{\s*return clearAuthRedirectTimer\s*\}, \[\]\)/.test(loginPageSource) &&
  /let mounted = true[\s\S]*?if \(mounted && session\.user\)/.test(loginPageSource) &&
  /return \(\) => \{\s*mounted = false\s*\}/.test(loginPageSource) &&
  /authRedirectTimerRef\.current = setTimeout\(\(\) => \{\s*navigateWithRetry\(postLoginRedirectPath/.test(
    loginPageSource
  ) &&
  /authRedirectTimerRef\.current = setTimeout\(\(\) => \{\s*router\.push\(['"]\/['"]\)/.test(
    loginPageSource
  ) &&
  !/^\s*setTimeout\(\(\) => \{\s*(?:navigateWithRetry\(postLoginRedirectPath|router\.push\(['"]\/['"]\))/m.test(
    loginPageSource
  )
const registerPendingGuardsSessionFetchUnmount =
  /useRef\(true\)/.test(authRegisterPendingPageSource) &&
  /const mountedRef/.test(authRegisterPendingPageSource) &&
  /mountedRef\.current = false/.test(authRegisterPendingPageSource) &&
  /if \(mountedRef\.current && session\.user\)/.test(authRegisterPendingPageSource) &&
  /if \(!mountedRef\.current\) \{\s*return\s*\}/.test(authRegisterPendingPageSource) &&
  /if \(mountedRef\.current\) \{\s*setCheckingStatus\(false\)\s*\}/.test(
    authRegisterPendingPageSource
  )
const resetPasswordUsesServerSessionTruth =
  /fetchSessionProfile/.test(resetPasswordPageSource) &&
  /fetch\(['"]\/api\/auth\/reset-password['"]/.test(resetPasswordPageSource) &&
  /export async function POST/.test(authResetPasswordApiSource) &&
  /parseJsonObjectBody/.test(authResetPasswordApiSource) &&
  /updateUser\(\{\s*password/.test(authResetPasswordApiSource) &&
  !/from\s+['"]@\/lib\/supabase\/client['"]/.test(resetPasswordPageSource) &&
  !/getSession\(\)/.test(resetPasswordPageSource) &&
  !/supabase\.auth\.updateUser/.test(resetPasswordPageSource)
const boardRoomClientPagesUseServerSessionTruth = boardRoomClientPageSources.every(
  ({ source }) =>
    (/fetchSessionProfile/.test(source) ||
      /fetch\(['"]\/api\/auth\/verify-session['"]/.test(source)) &&
    !/from\s+['"]@\/lib\/supabase\/client['"]/.test(source) &&
    !/import\(['"]@\/lib\/supabase\/client['"]\)/.test(source) &&
    !/from\(['"]member_profiles['"]\)/.test(source) &&
    !/getSession\(\)/.test(source)
)

const serverEnvPath = join(root, 'src/lib/server/env.ts')
const serverEnvSource = existsSync(serverEnvPath) ? readFileSync(serverEnvPath, 'utf8') : ''
const supabaseAdminPath = join(root, 'src/lib/server/supabaseAdmin.ts')
const supabaseAdminSource = existsSync(supabaseAdminPath)
  ? readFileSync(supabaseAdminPath, 'utf8')
  : ''
const authzPath = join(root, 'src/lib/server/authz.ts')
const authzSource = existsSync(authzPath) ? readFileSync(authzPath, 'utf8') : ''
const adminAuthPathForBoundary = join(root, 'src/lib/server/adminAuth.ts')
const adminAuthBoundarySource = readFileSync(adminAuthPathForBoundary, 'utf8')
const boardRoomAuthPathForBoundary = join(root, 'src/lib/server/boardRoomAuth.ts')
const boardRoomAuthBoundarySource = readFileSync(boardRoomAuthPathForBoundary, 'utf8')
const hasSharedOperationalBoundaryHelpers =
  /export type EnvGroupStatus/.test(serverEnvSource) &&
  /export function resolveFirstCompleteEnvGroup/.test(serverEnvSource) &&
  /export function requireServerEnv/.test(serverEnvSource) &&
  /export function getRedisRateLimitEnv/.test(serverEnvSource) &&
  /export function createServiceRoleClient/.test(supabaseAdminSource) &&
  /requireServerEnv\(['"]NEXT_PUBLIC_SUPABASE_URL['"]\)/.test(supabaseAdminSource) &&
  /requireServerEnv\(['"]SUPABASE_SERVICE_ROLE_KEY['"]\)/.test(supabaseAdminSource) &&
  !/serviceKey \|\| anonKey/.test(supabaseAdminSource) &&
  /export function isApprovedActive/.test(authzSource) &&
  /export function isApprovedActiveAdmin/.test(authzSource) &&
  /export function canAccessBoardRoom/.test(authzSource) &&
  /export async function requireAdminContext/.test(authzSource) &&
  /export async function requireBoardMemberContext/.test(authzSource)
const existingAuthHelpersUseSharedOperationalBoundaries =
  /from\s+['"]@\/lib\/server\/supabaseAdmin['"]/.test(adminAuthBoundarySource) &&
  /from\s+['"]@\/lib\/server\/authz['"]/.test(adminAuthBoundarySource) &&
  /createServiceRoleClient/.test(adminAuthBoundarySource) &&
  /isApprovedActiveAdmin/.test(adminAuthBoundarySource) &&
  !/from\s+['"]@supabase\/supabase-js['"]/.test(adminAuthBoundarySource) &&
  !/createClient\(/.test(adminAuthBoundarySource) &&
  /from\s+['"]@\/lib\/server\/supabaseAdmin['"]/.test(boardRoomAuthBoundarySource) &&
  /from\s+['"]@\/lib\/server\/authz['"]/.test(boardRoomAuthBoundarySource) &&
  /createServiceRoleClient/.test(boardRoomAuthBoundarySource) &&
  /canAccessBoardRoom/.test(boardRoomAuthBoundarySource) &&
  /isApprovedActiveAdmin/.test(boardRoomAuthBoundarySource) &&
  !/from\s+['"]@supabase\/supabase-js['"]/.test(boardRoomAuthBoundarySource) &&
  !/createClient\(/.test(boardRoomAuthBoundarySource)
const serverRateLimitPath = join(root, 'src/lib/server/rateLimit.ts')
const serverRateLimitSource = existsSync(serverRateLimitPath)
  ? readFileSync(serverRateLimitPath, 'utf8')
  : ''
const serverApiRoutePath = join(root, 'src/lib/server/apiRoute.ts')
const serverApiRouteSource = existsSync(serverApiRoutePath)
  ? readFileSync(serverApiRoutePath, 'utf8')
  : ''
const apiRouteFiles = globSync('src/app/api/**/route.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
})
const apiRoutesUsingLegacyRateLimitImports = apiRouteFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /from\s+['"]@\/utils\/(?:distributedRateLimiter|rateLimiter|rateLimit)['"]/.test(source)
})
const apiRoutesUsingDistributedRateLimitSymbols = apiRouteFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /distributedRateLimiter|DISTRIBUTED_RATE_LIMIT_CONFIGS|createDistributed(?:User|IP|Route)KeyGenerator|addDistributedRateLimitHeaders/.test(
    source
  )
})
const serviceRoleClientScanFiles = globSync('src/{app/api,lib/server,utils}/**/*.@(ts|tsx)', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**', 'src/lib/server/supabaseAdmin.ts'],
})
const directServiceRoleClientCreationFiles = serviceRoleClientScanFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /SUPABASE_SERVICE_ROLE_KEY/.test(source) && /createClient\(/.test(source)
})
const hasSharedServerRateLimitFacade =
  /export const RATE_LIMITS/.test(serverRateLimitSource) &&
  /export const RATE_LIMIT_CONFIGS/.test(serverRateLimitSource) &&
  /export async function applyRouteRateLimit/.test(serverRateLimitSource) &&
  /export async function applyRateLimit/.test(serverRateLimitSource) &&
  /export const withRateLimit/.test(serverRateLimitSource) &&
  /export const rateLimit/.test(serverRateLimitSource) &&
  /createUserKeyGenerator/.test(serverRateLimitSource) &&
  /addRateLimitHeaders/.test(serverRateLimitSource) &&
  /from\s+['"]@\/utils\/distributedRateLimiter['"]/.test(serverRateLimitSource)
const hasSharedJsonApiRouteWrapper =
  /export function defineApiRoute/.test(serverApiRouteSource) &&
  /applyRouteRateLimit/.test(serverApiRouteSource) &&
  /parseJsonObjectBody/.test(serverApiRouteSource) &&
  /requireAdmin/.test(serverApiRouteSource) &&
  /requireBoardMember/.test(serverApiRouteSource) &&
  /ApiError/.test(serverApiRouteSource) &&
  /handler:\s*\([\s\S]*?ctx:\s*ApiRouteContext/.test(serverApiRouteSource) &&
  /result instanceof NextResponse/.test(serverApiRouteSource)

const rateLimiterPath = join(root, 'src/utils/distributedRateLimiter.ts')
const rateLimiterSource = readFileSync(rateLimiterPath, 'utf8')
const rateLimiterCompatPath = join(root, 'src/utils/rateLimiter.ts')
const rateLimiterCompatSource = readFileSync(rateLimiterCompatPath, 'utf8')
const rateLimitWrapperPath = join(root, 'src/utils/rateLimit.ts')
const rateLimitWrapperSource = readFileSync(rateLimitWrapperPath, 'utf8')
const verifyEnvPath = join(root, 'scripts/verify-env.js')
const verifyEnvSource = readFileSync(verifyEnvPath, 'utf8')
const readmePath = join(root, 'README.md')
const readmeSource = readFileSync(readmePath, 'utf8')
const deploymentGuidePath = join(root, 'docs/deployment-guide.md')
const deploymentGuideSource = readFileSync(deploymentGuidePath, 'utf8')
const constructorMatch = rateLimiterSource.match(
  /constructor\s*\(\)\s*\{[\s\S]*?\n\s{2}\}\n\n\s{2}private reportMemoryFallbackIfNeeded/
)
const constructorSource = constructorMatch?.[0] ?? ''
const logsAtConstruction =
  /log\.(?:error|warn)\(/.test(constructorSource) || /logSecurityEvent\s*\(/.test(constructorSource)
const parsesRedisRateLimitStatsSafely =
  /parseIntegerParam/.test(rateLimiterSource) &&
  /count:\s*parseIntegerParam\(count,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(rateLimiterSource) &&
  !/count:\s*parseInt\(count/.test(rateLimiterSource)
const supportsVercelMarketplaceUpstashEnv =
  /function resolveFirstNonEmptyEnv/.test(rateLimiterSource) &&
  /resolveFirstNonEmptyEnv\(\[['"]UPSTASH_REDIS_REST_URL['"],\s*['"]KV_REST_API_URL['"]\]\)/.test(
    rateLimiterSource
  ) &&
  /resolveFirstNonEmptyEnv\(\[\s*['"]UPSTASH_REDIS_REST_TOKEN['"],\s*['"]KV_REST_API_TOKEN['"],?\s*\]\)/.test(
    rateLimiterSource
  ) &&
  /const redisEnvGroups =/.test(verifyEnvSource) &&
  /KV_REST_API_URL/.test(verifyEnvSource) &&
  /KV_REST_API_TOKEN/.test(verifyEnvSource) &&
  /hasCompleteEnvGroup\(env,\s*redisEnvGroups\)/.test(verifyEnvSource)
const productionRateLimiterFailsClosed =
  /private isProduction\(\): boolean/.test(rateLimiterSource) &&
  /private rateLimitUnavailable\(windowMs: number,\s*maxRequests: number\): RateLimitResult/.test(
    rateLimiterSource
  ) &&
  /Rate limiting is not configured for production/.test(rateLimiterSource) &&
  /status:\s*503/.test(rateLimiterSource) &&
  /this\.isProduction\(\) && \(this\.fallbackToMemory \|\| !this\.redis\)/.test(
    rateLimiterSource
  ) &&
  /if \(this\.isProduction\(\)\) \{\s*throw error\s*\}/.test(rateLimiterSource) &&
  /if \(this\.isProduction\(\)\) \{\s*return this\.rateLimitUnavailable\(windowMs,\s*maxRequests\)\s*\}/.test(
    rateLimiterSource
  )
const productionRateLimiterDocsFailClosed =
  /운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리합니다/.test(
    rateLimiterCompatSource
  ) &&
  /운영 환경에서는 rate limit 보호가 무효화되지 않도록 503으로 fail-closed 처리한다/.test(
    rateLimitWrapperSource
  ) &&
  /운영 환경은 applyRateLimit 진입부에서 이미 fail-closed 처리된다/.test(rateLimiterSource) &&
  /503으로 fail-closed 처리한다/.test(readmeSource) &&
  /개발 환경에서만 인메모리 폴백을 허용한다/.test(readmeSource) &&
  /rate-limited API 가 503 으로 fail-closed 됩니다/.test(deploymentGuideSource) &&
  !/Upstash 없으면 메모리 폴백/.test(readmeSource) &&
  !/미설정 시 메모리 기반 폴백으로 동작/.test(deploymentGuideSource)
const legacyRateLimitWrappersDelegateToServerFacade =
  /from\s+['"]@\/lib\/server\/rateLimit['"]/.test(rateLimiterCompatSource) &&
  /from\s+['"]@\/lib\/server\/rateLimit['"]/.test(rateLimitWrapperSource) &&
  !/from\s+['"]\.\/distributedRateLimiter['"]/.test(rateLimiterCompatSource) &&
  !/from\s+['"]\.\/distributedRateLimiter['"]/.test(rateLimitWrapperSource) &&
  !/distributedRateLimiter\.applyRateLimit/.test(rateLimitWrapperSource) &&
  !/distributedRateLimiterConfig\.applyRateLimit/.test(rateLimiterCompatSource)
const linkPreviewPath = join(root, 'src/utils/linkPreview.ts')
const linkPreviewSource = readFileSync(linkPreviewPath, 'utf8')
const ssrfProtectionPath = join(root, 'src/utils/ssrfProtection.ts')
const ssrfProtectionSource = readFileSync(ssrfProtectionPath, 'utf8')
const preventsLinkPreviewPreflightRedirects =
  /method:\s*['"]HEAD['"][\s\S]*?redirect:\s*['"]manual['"]/.test(linkPreviewSource) &&
  /new URL\(location,\s*u\)/.test(linkPreviewSource) &&
  /Redirect not followed/.test(linkPreviewSource)
const linkPreviewUsesSharedSsrfProtection =
  /from\s+['"]@\/utils\/ssrfProtection['"]/.test(linkPreviewSource) &&
  !/from\s+['"]dns\/promises['"]/.test(linkPreviewSource) &&
  !/function\s+isPrivateIPv4/.test(linkPreviewSource) &&
  !/async\s+function\s+isUnsafeHost/.test(linkPreviewSource)
const parsesLinkPreviewContentLengthSafely =
  /parseIntegerParam/.test(linkPreviewSource) &&
  /parseIntegerParam\(headRes\.headers\.get\(['"]content-length['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    linkPreviewSource
  ) &&
  /parseIntegerParam\(len,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(linkPreviewSource) &&
  !/parseInt\(headRes[\s\S]*content-length/.test(linkPreviewSource) &&
  !/parseInt\(len,\s*10\)/.test(linkPreviewSource)
const avoidsLinkPreviewOperationalConsoleLogs =
  /createLogger\(['"]linkPreview['"]\)/.test(linkPreviewSource) &&
  /function describeUrlForLog/.test(linkPreviewSource) &&
  /log\.debug\(['"]Successfully extracted preview['"]/.test(linkPreviewSource) &&
  /log\.debug\(['"]No image found for preview['"]/.test(linkPreviewSource) &&
  !/console\.log\(/.test(linkPreviewSource) &&
  !/console\.warn\(['"]⚠️ \[LinkPreview\] No image found/.test(linkPreviewSource) &&
  !/for: \$\{url\}/.test(linkPreviewSource) &&
  !/for \$\{url\}/.test(linkPreviewSource) &&
  !/preview for \$\{url\}/.test(linkPreviewSource) &&
  !/Invalid redirect URL: \$\{location\}/.test(linkPreviewSource) &&
  !/SSRF safety: \$\{location\}/.test(linkPreviewSource) &&
  !/Available meta tags:[\s\S]*?console\.log/.test(linkPreviewSource)
const ssrfProtectionHandlesLiteralIpsStrictly =
  /import\s+net\s+from\s+['"]net['"]/.test(ssrfProtectionSource) &&
  /normalizeHostname/.test(ssrfProtectionSource) &&
  /net\.isIP\(normalized\)/.test(ssrfProtectionSource) &&
  /a === 0/.test(ssrfProtectionSource) &&
  /a >= 224/.test(ssrfProtectionSource)
const validationPath = join(root, 'src/utils/validation.ts')
const validationSource = readFileSync(validationPath, 'utf8')
const validateUUIDSource =
  validationSource.match(/export const validateUUID[\s\S]*?\n\}\n\n\/\*\*/)?.[0] ?? ''
const validateUUIDRejectsTempIds =
  /export const validateUUIDOrTempId/.test(validationSource) &&
  !/isValidTempId/.test(validateUUIDSource) &&
  /잘못된 \$\{paramName\} 형식입니다\. UUID 형식이어야 합니다\./.test(validateUUIDSource)

const postAttachmentsPath = join(root, 'src/app/api/posts/[id]/attachments/route.ts')
const postAttachmentsSource = readFileSync(postAttachmentsPath, 'utf8')
const verifiesAttachmentSignature =
  /hasValidFileSignature/.test(postAttachmentsSource) &&
  /Buffer\.from\(await file\.arrayBuffer\(\)\)/.test(postAttachmentsSource)
const preservesTemporaryPostAttachmentUploads =
  /validateUUIDOrTempId/.test(postAttachmentsSource) &&
  /const uuidValidation = validateUUIDOrTempId\(postId,\s*['"]게시글 ID['"]\)/.test(
    postAttachmentsSource
  )
const boardDocumentsPath = join(root, 'src/app/api/board-room/documents/route.ts')
const boardDocumentsSource = readFileSync(boardDocumentsPath, 'utf8')
const boardDocumentDetailPath = join(root, 'src/app/api/board-room/documents/[id]/route.ts')
const boardDocumentDetailSource = readFileSync(boardDocumentDetailPath, 'utf8')
const boardDocumentStoragePathPath = join(root, 'src/utils/boardDocumentStoragePath.ts')
const boardDocumentStoragePathSource = existsSync(boardDocumentStoragePathPath)
  ? readFileSync(boardDocumentStoragePathPath, 'utf8')
  : ''
const verifiesBoardDocumentSignature =
  /hasKnownFileSignature/.test(boardDocumentsSource) &&
  /hasValidFileSignature/.test(boardDocumentsSource) &&
  /hasBinaryNullBytes/.test(boardDocumentsSource)
const validatesBoardDocumentStoragePaths =
  /isSafeBoardDocumentStoragePath/.test(boardDocumentStoragePathSource) &&
  /filePath\.startsWith\(`\$\{ownerId\}\/`\)/.test(boardDocumentStoragePathSource) &&
  /fileName\.includes\(['"]\/['"]\)/.test(boardDocumentStoragePathSource) &&
  /isSafeBoardDocumentStoragePath\(doc\.file_path,\s*doc\.uploaded_by\)/.test(
    boardDocumentsSource
  ) &&
  /download_url:\s*safeFilePath && signedData\?\.signedUrl/.test(boardDocumentsSource) &&
  /isSafeBoardDocumentStoragePath\(doc\.file_path,\s*doc\.uploaded_by\)/.test(
    boardDocumentDetailSource
  ) &&
  /\.remove\(\[doc\.file_path\]\)/.test(boardDocumentDetailSource) === false
const artistPhotoPath = join(root, 'src/app/api/mypage/artist/photo/route.ts')
const artistPhotoSource = readFileSync(artistPhotoPath, 'utf8')
const verifiesArtistPhotoSignature =
  /hasValidFileSignature/.test(artistPhotoSource) && /file instanceof File/.test(artistPhotoSource)
const validatesArtistPhotoCleanupStoragePaths =
  /collectSafeArtistVariantPaths/.test(artistPhotoSource) &&
  /isProjectStorageObjectPath\(value,\s*artistId\)/.test(artistPhotoSource) &&
  /getProjectStorageObjectPath/.test(artistPhotoSource) &&
  /getProjectStorageObjectPath\(\s*currentArtist\.profile_photo_url,\s*['"]artists['"],\s*profile\.artist_id\s*\)/.test(
    artistPhotoSource
  ) &&
  /getProjectStorageObjectPath\(\s*artist\.profile_photo_url,\s*['"]artists['"],\s*profile\.artist_id\s*\)/.test(
    artistPhotoSource
  ) &&
  !/const\s+url\s*=\s*new URL\(currentArtist\.profile_photo_url\)/.test(artistPhotoSource) &&
  !/const\s+url\s*=\s*new URL\(artist\.profile_photo_url\)/.test(artistPhotoSource)
const artistProfilePath = join(root, 'src/app/api/mypage/artist/route.ts')
const artistProfileSource = readFileSync(artistProfilePath, 'utf8')
const jsonSyncPath = join(root, 'src/utils/jsonSync.ts')
const jsonSyncSource = existsSync(jsonSyncPath) ? readFileSync(jsonSyncPath, 'utf8') : ''
const validatesArtistProfilePhotoStorageUrl =
  /isProjectStoragePublicUrl/.test(artistProfileSource) &&
  /isProjectStorageObjectPath/.test(artistProfileSource) &&
  /profile_photo_url/.test(artistProfileSource) &&
  /전용 업로드로 등록된 Storage URL/.test(artistProfileSource) &&
  /variants:\s*z/.test(artistProfileSource) &&
  /variant_urls:\s*z/.test(artistProfileSource) &&
  /variant_metadata:\s*z/.test(artistProfileSource) &&
  /프로필 사진 메타데이터의 Storage 경로가 올바르지 않습니다/.test(artistProfileSource) &&
  /프로필 사진 메타데이터의 공개 URL이 올바르지 않습니다/.test(artistProfileSource)
const preventsArtistProfileServerGitSideEffects =
  !/jsonSync/.test(artistProfileSource) &&
  !/updateArtistInJsonFile/.test(artistProfileSource) &&
  !/commitAndPushJsonChanges/.test(artistProfileSource) &&
  !/setImmediate\s*\(/.test(artistProfileSource) &&
  !existsSync(jsonSyncPath) &&
  !/child_process/.test(jsonSyncSource) &&
  !/git (?:add|commit|push)/.test(jsonSyncSource) &&
  !/commitAndPushJsonChanges/.test(jsonSyncSource)
const postOgImagePath = join(root, 'src/app/api/og/post/[id]/route.tsx')
const postOgImageSource = readFileSync(postOgImagePath, 'utf8')
const postUserDataApiPath = join(root, 'src/app/api/posts/[id]/user-data/route.ts')
const postUserDataApiSource = readFileSync(postUserDataApiPath, 'utf8')
const validatesPostOgAttachmentStorageUrl =
  /isProjectStoragePublicUrl/.test(postOgImageSource) &&
  /attachments\[0\]\.file_url/.test(postOgImageSource) &&
  /isProjectStoragePublicUrl\(imageUrl,\s*['"]attachments['"],\s*['"]posts['"]\)/.test(
    postOgImageSource
  ) &&
  /unsafe attachment image URL/i.test(postOgImageSource)
const artistOgImagePath = join(root, 'src/app/api/og/artist/[slug]/route.tsx')
const artistOgImageSource = readFileSync(artistOgImagePath, 'utf8')
const projectOgImagePath = join(root, 'src/app/api/og/project/[slug]/route.tsx')
const projectOgImageSource = readFileSync(projectOgImagePath, 'utf8')
const legacyOgImagePath = join(root, 'src/app/api/og-image/route.ts')
const legacyOgImageSource = readFileSync(legacyOgImagePath, 'utf8')
const imagesApiPath = join(root, 'src/app/api/images/route.ts')
const imagesApiSource = readFileSync(imagesApiPath, 'utf8')
const validatesStaticOgImageRedirects =
  /toSafeInternalImagePath/.test(artistOgImageSource) &&
  /toSafeInternalImagePath\(artist\?\.profileImage/.test(artistOgImageSource) &&
  /toSafeInternalImagePath/.test(projectOgImageSource) &&
  /toSafeInternalImagePath\(project\.coverImage/.test(projectOgImageSource) &&
  /toSafeInternalImagePath\(project\.gallery\[0\]/.test(projectOgImageSource) &&
  /Location:\s*safeTarget/.test(artistOgImageSource) &&
  /Location:\s*safeTarget/.test(projectOgImageSource) &&
  !/Location:\s*target/.test(artistOgImageSource) &&
  !/Location:\s*target/.test(projectOgImageSource) &&
  /toSafeInternalImagePath/.test(legacyOgImageSource) &&
  /let imagePath = toSafeInternalImagePath\(artist\.profileImage\)/.test(legacyOgImageSource) &&
  !/let imagePath = artist\.profileImage/.test(legacyOgImageSource)
const validatesImagesApiPublicPathBoundary =
  /function resolvePublicImagePath/.test(imagesApiSource) &&
  /path\.relative\(publicPath,\s*resolved\)/.test(imagesApiSource) &&
  /relativePath\.startsWith\(['"]\.\.['"]\)/.test(imagesApiSource) &&
  /path\.isAbsolute\(relativePath\)/.test(imagesApiSource) &&
  /const imageMimeTypes/.test(imagesApiSource) &&
  /const contentType = imageMimeTypes\[ext\]/.test(imagesApiSource) &&
  /!contentType/.test(imagesApiSource) &&
  /resolvePublicImagePath\(imagePath\)/.test(imagesApiSource) &&
  !/resolved(?:Head)?\.startsWith\(publicPath\)/.test(imagesApiSource) &&
  !/application\/octet-stream/.test(imagesApiSource)
const commentDeletePath = join(root, 'src/app/api/posts/[id]/comments/[commentId]/route.ts')
const commentDeleteSource = readFileSync(commentDeletePath, 'utf8')
const scopesCommentDeleteToPost =
  /from\(['"]comments['"]\)[\s\S]*?\.select\(['"]id, author_id['"]\)[\s\S]*?\.eq\(['"]id['"],\s*validCommentId\)[\s\S]*?\.eq\(['"]post_id['"],\s*validPostId\)/.test(
    commentDeleteSource
  ) &&
  /from\(['"]comments['"]\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\(['"]id['"],\s*validCommentId\)[\s\S]*?\.eq\(['"]post_id['"],\s*validPostId\)/.test(
    commentDeleteSource
  )
const postAttachmentDetailPath = join(
  root,
  'src/app/api/posts/[id]/attachments/[attachmentId]/route.ts'
)
const postAttachmentDetailSource = readFileSync(postAttachmentDetailPath, 'utf8')
const postAttachmentsDisplayPath = join(root, 'src/components/PostAttachmentsDisplay.tsx')
const postAttachmentsDisplaySource = readFileSync(postAttachmentsDisplayPath, 'utf8')
const attachmentCardPath = join(root, 'src/components/attachments/AttachmentCard.tsx')
const attachmentCardSource = readFileSync(attachmentCardPath, 'utf8')
const imageModalPath = join(root, 'src/components/attachments/ImageModal.tsx')
const imageModalSource = readFileSync(imageModalPath, 'utf8')
const attachmentActionsPath = join(root, 'src/hooks/useAttachmentActions.ts')
const attachmentActionsSource = readFileSync(attachmentActionsPath, 'utf8')
const validatesAttachmentMetadataUpdate =
  /validateUUID\(params\.id,\s*['"]게시글 ID['"]\)/.test(postAttachmentDetailSource) &&
  /validateUUID\(params\.attachmentId,\s*['"]첨부파일 ID['"]\)/.test(postAttachmentDetailSource) &&
  /MAX_ALT_TEXT_LENGTH/.test(postAttachmentDetailSource) &&
  /typeof alt_text !== ['"]string['"]/.test(postAttachmentDetailSource) &&
  /typeof is_primary !== ['"]boolean['"]/.test(postAttachmentDetailSource) &&
  /Number\.isInteger\(sort_order\)/.test(postAttachmentDetailSource) &&
  /\.update\(updateData\)[\s\S]*?\.eq\(['"]id['"],\s*attachmentId\)[\s\S]*?\.eq\(['"]post_id['"],\s*postId\)/.test(
    postAttachmentDetailSource
  ) &&
  /from\(['"]post_attachments['"]\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\(['"]id['"],\s*attachmentId\)[\s\S]*?\.eq\(['"]post_id['"],\s*postId\)/.test(
    postAttachmentDetailSource
  )
const validatesAttachmentDeleteAdminStatus =
  /select\(['"]is_admin,\s*registration_status,\s*is_active['"]\)/.test(
    postAttachmentDetailSource
  ) &&
  /profile\?\.is_admin === true[\s\S]*?profile\.registration_status === ['"]approved['"][\s\S]*?profile\.is_active === true/.test(
    postAttachmentDetailSource
  )
const validatesAttachmentDeleteStoragePath =
  /getProjectStorageObjectPath/.test(postAttachmentDetailSource) &&
  /getProjectStorageObjectPath\(\s*attachment\.file_url,\s*['"]attachments['"],\s*`posts\/\$\{postId\}`\s*\)/.test(
    postAttachmentDetailSource
  ) &&
  /\.remove\(\[storagePath\]\)/.test(postAttachmentDetailSource) &&
  !/attachment\.file_url\.split\(['"]\/['"]\)/.test(postAttachmentDetailSource)
const validatesPostAttachmentRenderUrls =
  /isProjectStoragePublicUrl/.test(postAttachmentsDisplaySource) &&
  /isSafeAttachmentUrl/.test(postAttachmentsDisplaySource) &&
  /safeImages/.test(postAttachmentsDisplaySource) &&
  /safeOtherFiles/.test(postAttachmentsDisplaySource) &&
  !/src=\{image\.file_url\}/.test(postAttachmentsDisplaySource) &&
  !/href=\{file\.file_url\}/.test(postAttachmentsDisplaySource) &&
  !/src=\{selectedImage\.file_url\}/.test(postAttachmentsDisplaySource) &&
  /isProjectStoragePublicUrl/.test(attachmentCardSource) &&
  /safeFileUrl/.test(attachmentCardSource) &&
  !/src=\{attachment\.file_url\}/.test(attachmentCardSource) &&
  /isProjectStoragePublicUrl/.test(imageModalSource) &&
  /safeFileUrl/.test(imageModalSource) &&
  !/src=\{attachment\.file_url\}/.test(imageModalSource) &&
  /isProjectStoragePublicUrl/.test(attachmentActionsSource) &&
  /safeFileUrl/.test(attachmentActionsSource) &&
  !/link\.href\s*=\s*attachment\.file_url/.test(attachmentActionsSource)
const adminPostDetailPath = join(root, 'src/app/api/admin/posts/[id]/route.ts')
const adminPostDetailSource = readFileSync(adminPostDetailPath, 'utf8')
const validatesAdminPostRouteId =
  /validateUUID\(resolvedParams\.id,\s*['"]게시글 ID['"]\)/.test(adminPostDetailSource) &&
  /\.eq\(['"]id['"],\s*postId\)/.test(adminPostDetailSource)
const notificationDetailPath = join(root, 'src/app/api/notifications/[id]/route.ts')
const notificationDetailSource = readFileSync(notificationDetailPath, 'utf8')
const notificationsPath = join(root, 'src/app/api/notifications/route.ts')
const notificationsSource = readFileSync(notificationsPath, 'utf8')
const bulkNotificationsPath = join(root, 'src/app/api/notifications/bulk/route.ts')
const bulkNotificationsSource = readFileSync(bulkNotificationsPath, 'utf8')
const notificationDataPath = join(root, 'src/utils/notificationData.ts')
const notificationDataSource = readFileSync(notificationDataPath, 'utf8')
const notificationExpiryPath = join(root, 'src/utils/notificationExpiry.ts')
const notificationExpirySource = readFileSync(notificationExpiryPath, 'utf8')
const notificationTypesPath = join(root, 'src/utils/notificationTypes.ts')
const notificationTypesSource = readFileSync(notificationTypesPath, 'utf8')
const eventApplicationStatusPath = join(root, 'src/utils/eventApplicationStatus.ts')
const eventApplicationStatusSource = readFileSync(eventApplicationStatusPath, 'utf8')
const adminEventApplicationsApiPath = join(root, 'src/app/api/admin/event-applications/route.ts')
const adminEventApplicationsApiSource = readFileSync(adminEventApplicationsApiPath, 'utf8')
const adminMemberActionApiPath = join(root, 'src/app/api/admin/member-action/route.ts')
const adminMemberActionApiSource = readFileSync(adminMemberActionApiPath, 'utf8')
const adminMemberFlagsApiPath = join(root, 'src/app/api/admin/members/flags/route.ts')
const adminMemberFlagsApiSource = readFileSync(adminMemberFlagsApiPath, 'utf8')
const adminMembersBulkApiPath = join(root, 'src/app/api/admin/members/bulk/route.ts')
const adminMembersBulkApiSource = readFileSync(adminMembersBulkApiPath, 'utf8')
const adminArtistMembersApiPath = join(root, 'src/app/api/admin/artists/[id]/members/route.ts')
const adminArtistMembersApiSource = readFileSync(adminArtistMembersApiPath, 'utf8')
const adminArtistMemberApiPath = join(
  root,
  'src/app/api/admin/artists/[id]/members/[memberId]/route.ts'
)
const adminArtistMemberApiSource = readFileSync(adminArtistMemberApiPath, 'utf8')
const validatesNotificationRouteId =
  (notificationDetailSource.match(/validateUUID\(resolvedParams\.id,\s*['"]알림 ID['"]\)/g) ?? [])
    .length >= 2 &&
  /p_notification_id:\s*notificationId/.test(notificationDetailSource) &&
  /\.eq\(['"]id['"],\s*notificationId\)/.test(notificationDetailSource)
const validatesNotificationMutationIds =
  /validateUUID/.test(notificationsSource) &&
  /parseNotificationType\(typeParam\)/.test(notificationsSource) &&
  /parseNotificationType\(body\.type\)/.test(notificationsSource) &&
  /p_type:\s*notificationType/.test(notificationsSource) &&
  !/body\.type\.length\s*>\s*50/.test(notificationsSource) &&
  /validateNotificationId\(body\.user_id,\s*['"]사용자 ID['"]\)/.test(notificationsSource) &&
  /p_user_id:\s*userId/.test(notificationsSource) &&
  /p_related_post_id:\s*relatedPostId/.test(notificationsSource) &&
  /p_related_user_id:\s*relatedUserId/.test(notificationsSource) &&
  /sanitizeNotificationData\(body\.data\)/.test(notificationsSource) &&
  /p_data:\s*notificationData/.test(notificationsSource) &&
  /parseNotificationExpiresAt\(body\.expires_at\)/.test(notificationsSource) &&
  /p_expires_at:\s*expiresAt/.test(notificationsSource) &&
  /const notificationTitle = typeof body\.title === ['"]string['"] \? body\.title\.trim\(\) : ['"]['"]/.test(
    notificationsSource
  ) &&
  /p_title:\s*notificationTitle/.test(notificationsSource) &&
  /const notificationMessage = typeof body\.message === ['"]string['"] \? body\.message\.trim\(\) : ['"]['"]/.test(
    notificationsSource
  ) &&
  /p_message:\s*notificationMessage/.test(notificationsSource) &&
  !/p_data:\s*body\.data\s*\|\|\s*\{\}/.test(notificationsSource) &&
  !/p_expires_at:\s*body\.expires_at\s*\|\|\s*null/.test(notificationsSource) &&
  !/p_title:\s*body\.title/.test(notificationsSource) &&
  !/p_message:\s*body\.message/.test(notificationsSource) &&
  /validateUUID/.test(bulkNotificationsSource) &&
  /parseNotificationType\(body\.type\)/.test(bulkNotificationsSource) &&
  /p_type:\s*notificationType/.test(bulkNotificationsSource) &&
  !/body\.type\.length\s*>\s*50/.test(bulkNotificationsSource) &&
  /const\s+userIds:\s*string\[\] = \[\]/.test(bulkNotificationsSource) &&
  /userIds\.push\(userId\)/.test(bulkNotificationsSource) &&
  /p_user_ids:\s*userIds/.test(bulkNotificationsSource) &&
  /sanitizeNotificationData\(body\.data\)/.test(bulkNotificationsSource) &&
  /p_data:\s*notificationData/.test(bulkNotificationsSource) &&
  /parseNotificationExpiresAt\(body\.expires_at\)/.test(bulkNotificationsSource) &&
  /p_expires_at:\s*expiresAt/.test(bulkNotificationsSource) &&
  /const notificationTitle = typeof body\.title === ['"]string['"] \? body\.title\.trim\(\) : ['"]['"]/.test(
    bulkNotificationsSource
  ) &&
  /p_title:\s*notificationTitle/.test(bulkNotificationsSource) &&
  /const notificationMessage = typeof body\.message === ['"]string['"] \? body\.message\.trim\(\) : ['"]['"]/.test(
    bulkNotificationsSource
  ) &&
  /p_message:\s*notificationMessage/.test(bulkNotificationsSource) &&
  !/p_data:\s*body\.data\s*\|\|\s*\{\}/.test(bulkNotificationsSource) &&
  !/p_expires_at:\s*body\.expires_at\s*\|\|\s*null/.test(bulkNotificationsSource) &&
  !/p_title:\s*body\.title/.test(bulkNotificationsSource) &&
  !/p_message:\s*body\.message/.test(bulkNotificationsSource) &&
  /RESERVED_NOTIFICATION_DATA_KEYS/.test(notificationDataSource) &&
  /['"]post_id['"]/.test(notificationDataSource) &&
  /['"]related_post_id['"]/.test(notificationDataSource) &&
  /parseNotificationExpiresAt/.test(notificationExpirySource) &&
  /Number\.isFinite\(parsed\.getTime\(\)\)/.test(notificationExpirySource) &&
  /parsed\.getTime\(\) > Date\.now\(\)/.test(notificationExpirySource) &&
  /NOTIFICATION_TYPES/.test(notificationTypesSource) &&
  /satisfies\s+readonly\s+NotificationType\[\]/.test(notificationTypesSource)
const validatesEventApplicationStatusAllowlist =
  /EVENT_APPLICATION_STATUSES\s*=\s*\[['"]pending['"],\s*['"]approved['"],\s*['"]rejected['"]\]\s+as const/.test(
    eventApplicationStatusSource
  ) &&
  /parseEventApplicationStatus/.test(eventApplicationStatusSource) &&
  /parseEventApplicationStatus\(statusParam\)/.test(adminEventApplicationsApiSource) &&
  /if\s*\(statusParam && !status\)/.test(adminEventApplicationsApiSource) &&
  /query = query\.eq\(['"]status['"],\s*status\)/.test(adminEventApplicationsApiSource) &&
  /z\.enum\(EVENT_APPLICATION_STATUSES/.test(adminEventApplicationsApiSource) &&
  !/const status = searchParams\.get\(['"]status['"]\) \|\| ['"]['"]/.test(
    adminEventApplicationsApiSource
  ) &&
  !/query = query\.eq\(['"]status['"],\s*statusParam\)/.test(adminEventApplicationsApiSource)
const validatesAdminEventApplicationSlug =
  /isValidEventSlug/.test(adminEventApplicationsApiSource) &&
  /normalizeEventSlug/.test(adminEventApplicationsApiSource) &&
  /const eventSlugParam = searchParams\.get\(['"]event_slug['"]\) \|\| ['"]['"]/.test(
    adminEventApplicationsApiSource
  ) &&
  /const eventSlug = normalizeEventSlug\(eventSlugParam\)/.test(adminEventApplicationsApiSource) &&
  /if\s*\(eventSlugParam && !isValidEventSlug\(eventSlug\)\)/.test(
    adminEventApplicationsApiSource
  ) &&
  /query = query\.eq\(['"]event_slug['"],\s*eventSlug\)/.test(adminEventApplicationsApiSource) &&
  !/query = query\.eq\(['"]event_slug['"],\s*eventSlugParam\)/.test(adminEventApplicationsApiSource)
const validatesEventApplicationDeleteId =
  /validateUUID\(id \?\? ['"]['"],\s*['"]신청 ID['"]\)/.test(adminEventApplicationsApiSource) &&
  /const applicationId = idValidation\.sanitized/.test(adminEventApplicationsApiSource) &&
  /\.delete\(\)\.eq\(['"]id['"],\s*applicationId\)/.test(adminEventApplicationsApiSource) &&
  /ApiSuccess\.ok\(\{\s*id:\s*applicationId\s*\}/.test(adminEventApplicationsApiSource) &&
  !/\^\[0-9a-f-\]\{36\}\$/.test(adminEventApplicationsApiSource) &&
  !/\.delete\(\)\.eq\(['"]id['"],\s*id\)/.test(adminEventApplicationsApiSource)
const userLikesPath = join(root, 'src/app/api/users/[id]/likes/route.ts')
const userLikesSource = readFileSync(userLikesPath, 'utf8')
const validatesUserLikesRouteId =
  /validateUUID\(resolvedParams\.id,\s*['"]사용자 ID['"]\)/.test(userLikesSource) &&
  /p_user_id:\s*requestedUserId/.test(userLikesSource) &&
  /\.eq\(['"]user_id['"],\s*requestedUserId\)/.test(userLikesSource)
const validatesUserLikesAdminStatus =
  /select\(['"]is_admin,\s*registration_status,\s*is_active['"]\)/.test(userLikesSource) &&
  /profile\.registration_status !== ['"]approved['"][\s\S]*?!profile\.is_active/.test(
    userLikesSource
  )
const postDetailPath = join(root, 'src/app/api/posts/[id]/route.ts')
const postDetailSource = readFileSync(postDetailPath, 'utf8')
const boardPostDetailPath = join(root, 'src/app/api/board/post/[id]/route.ts')
const boardPostDetailSource = readFileSync(boardPostDetailPath, 'utf8')
const serverBoardPath = join(root, 'src/lib/server/board.ts')
const serverBoardSource = readFileSync(serverBoardPath, 'utf8')
const boardCategoriesPath = join(root, 'src/constants/categories.ts')
const boardCategoriesSource = readFileSync(boardCategoriesPath, 'utf8')
const boardCategoryPagePath = join(root, 'src/app/[locale]/board/page.tsx')
const boardCategoryPageSource = readFileSync(boardCategoryPagePath, 'utf8')
const boardServerDataPath = join(root, 'src/app/[locale]/board/BoardServerData.tsx')
const boardServerDataSource = readFileSync(boardServerDataPath, 'utf8')
const boardPostsApiPath = join(root, 'src/app/api/board/posts/route.ts')
const boardPostsApiSource = readFileSync(boardPostsApiPath, 'utf8')
const boardListPostsApiPath = join(root, 'src/app/api/posts/route.ts')
const boardListPostsApiSource = readFileSync(boardListPostsApiPath, 'utf8')
const publicPostsApiPath = join(root, 'src/app/api/posts/public/route.ts')
const publicPostsApiSource = readFileSync(publicPostsApiPath, 'utf8')
const keysetCursorPath = join(root, 'src/utils/keysetCursor.ts')
const keysetCursorSource = readFileSync(keysetCursorPath, 'utf8')
const boardDetailPagePath = join(root, 'src/app/[locale]/board/[id]/page.tsx')
const boardDetailPageSource = readFileSync(boardDetailPagePath, 'utf8')
const commentsApiPath = join(root, 'src/app/api/posts/[id]/comments/route.ts')
const commentsApiSource = readFileSync(commentsApiPath, 'utf8')
const commentsListApiPath = join(root, 'src/app/api/posts/[id]/comments-list/route.ts')
const commentsListApiSource = readFileSync(commentsListApiPath, 'utf8')
const postContentApiPath = join(root, 'src/app/api/posts/[id]/content/route.ts')
const postContentApiSource = readFileSync(postContentApiPath, 'utf8')
const postLikesApiPath = join(root, 'src/app/api/posts/[id]/likes/route.ts')
const postLikesApiSource = readFileSync(postLikesApiPath, 'utf8')
const commentLikeApiPath = join(root, 'src/app/api/comments/[id]/like/route.ts')
const commentLikeApiSource = readFileSync(commentLikeApiPath, 'utf8')
const boardPageShellPath = join(root, 'src/components/board/BoardPageShell.tsx')
const boardPageShellSource = readFileSync(boardPageShellPath, 'utf8')
const serverBoardViewPath = join(root, 'src/components/board/ServerBoardView.tsx')
const serverBoardViewSource = readFileSync(serverBoardViewPath, 'utf8')
const validatesBoardCategoryFilters =
  /export const parseBoardCategory/.test(boardCategoriesSource) &&
  /parseBoardCategory\(category\) \?\? ['"]전체['"]/.test(serverBoardSource) &&
  /query = query\.eq\(['"]category['"],\s*safeCategory\)/.test(serverBoardSource) &&
  /parseBoardCategory\(resolved\.category\) \?\? ['"]전체['"]/.test(boardCategoryPageSource) &&
  /category\?: BoardCategory/.test(boardServerDataSource) &&
  /category: BoardCategory/.test(boardPageShellSource) &&
  /category: BoardCategory/.test(serverBoardViewSource) &&
  /parseBoardCategory\(categoryParam\)/.test(boardPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(boardPostsApiSource) &&
  /ApiError\.badRequest\(['"]유효하지 않은 카테고리입니다\.['"]\)/.test(boardPostsApiSource) &&
  /parseBoardCategory\(categoryParam\)/.test(boardListPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(boardListPostsApiSource) &&
  /throw ApiError\.badRequest\(['"]유효하지 않은 카테고리입니다\.['"]\)/.test(
    boardListPostsApiSource
  ) &&
  /parseBoardCategory\(categoryParam\)/.test(publicPostsApiSource) &&
  /const boardCategory = parseBoardCategory\(categoryParam\)/.test(publicPostsApiSource) &&
  /createErrorResponse\(\{\s*success:\s*false,\s*error:\s*['"]유효하지 않은 카테고리입니다\.['"]\s*\},\s*400\)/.test(
    publicPostsApiSource
  ) &&
  !/const allowedCategories = \[['"]전체['"],\s*['"]공지['"],\s*['"]잡담['"],\s*['"]홍보['"],\s*['"]건의['"]\]/.test(
    boardListPostsApiSource
  ) &&
  !/query = query\.eq\(['"]category['"],\s*category\)/.test(serverBoardSource) &&
  !/query = query\.eq\(['"]category['"],\s*category\)/.test(publicPostsApiSource)
const validatesPublicPostsCursor =
  /parseTimestampUuidCursor/.test(keysetCursorSource) &&
  /formatTimestampUuidCursor/.test(keysetCursorSource) &&
  /validateUUID\(parts\[1\] \?\? ['"]['"],\s*idLabel\)/.test(keysetCursorSource) &&
  /Number\.isFinite\(Date\.parse\(createdAt\)\)/.test(keysetCursorSource) &&
  /parsePublicPostsSortOrder/.test(publicPostsApiSource) &&
  /const parsedCursor = cursor \? parseTimestampUuidCursor\(cursor,\s*['"]게시글 ID['"]\) : null/.test(
    publicPostsApiSource
  ) &&
  /if\s*\(cursor && !parsedCursor\)/.test(publicPostsApiSource) &&
  /if\s*\(!sortOrder\)/.test(publicPostsApiSource) &&
  /query = query\.order\(['"]created_at['"],\s*\{\s*ascending\s*\}\)/.test(publicPostsApiSource) &&
  /query = query\.order\(['"]id['"],\s*\{\s*ascending\s*\}\)/.test(publicPostsApiSource) &&
  /has_prev:\s*!!parsedCursor/.test(publicPostsApiSource) &&
  !/const sortOrder = \(searchParams\.get\(['"]sort['"]\) \|\| ['"]desc['"]\)\.toLowerCase\(\) === ['"]asc['"] \? ['"]asc['"] : ['"]desc['"]/.test(
    publicPostsApiSource
  ) &&
  !/if\s*\(cursor\)[\s\S]*?const \[enc,\s*rawId\] = cursor\.split\(['"]\|['"]\)/.test(
    publicPostsApiSource
  ) &&
  !/has_prev:\s*!!cursor/.test(publicPostsApiSource)
const validatesCommentCursors =
  /parseTimestampUuidCursor\(cursor,\s*['"]댓글 ID['"]\)/.test(commentsApiSource) &&
  /parseTimestampUuidCursor\(cursor,\s*['"]댓글 ID['"]\)/.test(commentsListApiSource) &&
  /if\s*\(cursor && !parsedCursor\)/.test(commentsApiSource) &&
  /if\s*\(cursor && !parsedCursor\)/.test(commentsListApiSource) &&
  /formatTimestampUuidCursor\(last\.created_at,\s*last\.id\)/.test(commentsApiSource) &&
  /formatTimestampUuidCursor\(last\.created_at,\s*last\.id\)/.test(commentsListApiSource) &&
  /p_created_at:\s*parsedCursor\?\.createdAt \?\? null/.test(commentsListApiSource) &&
  /p_id:\s*parsedCursor\?\.id \?\? null/.test(commentsListApiSource) &&
  !/decodeURIComponent\(cursor\)/.test(commentsApiSource) &&
  !/decodeURIComponent\(cursor\)/.test(commentsListApiSource)
const commentLikesHelperPath = join(root, 'src/lib/server/commentLikes.ts')
const commentLikesHelperSource = existsSync(commentLikesHelperPath)
  ? readFileSync(commentLikesHelperPath, 'utf8')
  : ''
const annotatesAuthenticatedCommentLikeState =
  /export async function getUserLikedCommentIds/.test(commentLikesHelperSource) &&
  /\.from\(['"]comment_likes['"]\)/.test(commentLikesHelperSource) &&
  /\.eq\(['"]user_id['"],\s*userId\)/.test(commentLikesHelperSource) &&
  /getUserLikedCommentIds\(supabaseServer,\s*serverUser\.id,\s*commentIds\)/.test(
    boardDetailPageSource
  ) &&
  /is_liked:\s*likedCommentIds\.has\(String\(comment\.id\)\)/.test(boardDetailPageSource) &&
  /getUserLikedCommentIds\(sessionSupabase,\s*user\.id,\s*commentIds\)/.test(commentsApiSource) &&
  /getUserLikedCommentIds\(sessionSupabase,\s*user\.id,\s*commentIds\)/.test(
    commentsListApiSource
  ) &&
  /is_liked:\s*likedCommentIds\.has\(String\(c\.id\)\)/.test(commentsApiSource) &&
  /is_liked:\s*likedCommentIds\.has\(String\(c\.id\)\)/.test(commentsListApiSource)
const validatesPostRouteIdsUseSanitizedUuid =
  /const applicationId = idValidation\.sanitized/.test(adminEventApplicationsApiSource) &&
  /\.update\(\{ status,[\s\S]*?\.eq\(['"]id['"],\s*applicationId\)/.test(
    adminEventApplicationsApiSource
  ) &&
  /\.update\(updateData\)\.eq\(['"]id['"],\s*applicationId\)/.test(
    adminEventApplicationsApiSource
  ) &&
  !/\.update\(\{ status,[\s\S]*?\.eq\(['"]id['"],\s*id\)/.test(adminEventApplicationsApiSource) &&
  /const memberIdValidation = validateUUID\(parsedInput\.memberId,\s*['"]멤버 ID['"]\)/.test(
    adminMemberActionApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminMemberActionApiSource) &&
  /\.eq\(['"]id['"],\s*memberId\)/.test(adminMemberActionApiSource) &&
  /data\.action === ['"]suspend['"]/.test(adminMemberActionApiSource) &&
  /data\.suspension_reason === undefined && data\.suspension_until === undefined/.test(
    adminMemberActionApiSource
  ) &&
  /const memberIdValidation = validateUUID\(parsed\.data\.memberId,\s*['"]멤버 ID['"]\)/.test(
    adminMemberFlagsApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminMemberFlagsApiSource) &&
  /\.eq\(['"]id['"],\s*memberId\)/.test(adminMemberFlagsApiSource) &&
  /const sanitizedMemberIds:\s*string\[\] = \[\]/.test(adminMembersBulkApiSource) &&
  /sanitizedMemberIds\.push\(memberIdValidation\.sanitized\)/.test(adminMembersBulkApiSource) &&
  /member_ids:\s*sanitizedMemberIds/.test(adminMembersBulkApiSource) &&
  /for \(const memberId of sanitizedMemberIds\)/.test(adminMembersBulkApiSource) &&
  /function parseArtistLegacyId/.test(adminArtistMembersApiSource) &&
  /const artistId = parseArtistLegacyId\(getRouteParam\(params\.id\)\)/.test(
    adminArtistMembersApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminArtistMembersApiSource) &&
  /\.eq\(['"]legacy_id['"],\s*artistId\)/.test(adminArtistMembersApiSource) &&
  /artist_id:\s*artistId/.test(adminArtistMembersApiSource) &&
  /function parseArtistLegacyId/.test(adminArtistMemberApiSource) &&
  /const artistId = parseArtistLegacyId\(getRouteParam\(params\.id\)\)/.test(
    adminArtistMemberApiSource
  ) &&
  /const memberId = memberIdValidation\.sanitized/.test(adminArtistMemberApiSource) &&
  /\.eq\(['"]id['"],\s*memberId\)/.test(adminArtistMemberApiSource) &&
  /const postId = uuidValidation\.sanitized/.test(postContentApiSource) &&
  /\.eq\(['"]id['"],\s*postId\)/.test(postContentApiSource) &&
  !/\.eq\(['"]id['"],\s*id\)/.test(postContentApiSource) &&
  /const validPostId = uuidValidation\.sanitized/.test(boardPostDetailSource) &&
  /\.eq\(['"]id['"],\s*validPostId\)/.test(boardPostDetailSource) &&
  /\.eq\(['"]post_id['"],\s*validPostId\)/.test(boardPostDetailSource) &&
  !/\.eq\(['"]id['"],\s*postId\)/.test(boardPostDetailSource) &&
  /const postId = uuidValidation\.sanitized/.test(commentsApiSource) &&
  /\.eq\(['"]post_id['"],\s*postId\)/.test(commentsApiSource) &&
  /const validPostId = postIdValidation\.sanitized/.test(commentsApiSource) &&
  /post_id:\s*validPostId/.test(commentsApiSource) &&
  !/post_id:\s*postId/.test(commentsApiSource) &&
  /const postId = uuidValidation\.sanitized/.test(commentsListApiSource) &&
  /p_post_id:\s*postId/.test(commentsListApiSource) &&
  /\.eq\(['"]post_id['"],\s*postId\)/.test(commentsListApiSource) &&
  !/p_post_id:\s*id/.test(commentsListApiSource) &&
  /const validPostId = uuidValidation\.sanitized/.test(postLikesApiSource) &&
  /\.eq\(['"]id['"],\s*validPostId\)/.test(postLikesApiSource) &&
  /\.eq\(['"]post_id['"],\s*validPostId\)/.test(postLikesApiSource) &&
  /post_id:\s*validPostId/.test(postLikesApiSource) &&
  /const postId = postIdValidation\.sanitized/.test(postOgImageSource) &&
  /\.eq\(['"]id['"],\s*postId\)/.test(postOgImageSource) &&
  /\.eq\(['"]post_id['"],\s*postId\)/.test(postOgImageSource) &&
  /const userIdValidation = validateUUID\(userIdFromQuery,\s*['"]사용자 ID['"]\)/.test(
    postUserDataApiSource
  ) &&
  /userIdValidation\.sanitized !== user\.id/.test(postUserDataApiSource) &&
  /const validPostId = postIdValidation\.sanitized/.test(commentDeleteSource) &&
  /const validCommentId = commentIdValidation\.sanitized/.test(commentDeleteSource) &&
  /\.eq\(['"]id['"],\s*validCommentId\)/.test(commentDeleteSource) &&
  /\.eq\(['"]post_id['"],\s*validPostId\)/.test(commentDeleteSource) &&
  !/\.eq\(['"]id['"],\s*commentId\)/.test(commentDeleteSource) &&
  /const validCommentId = uuidValidation\.sanitized/.test(commentLikeApiSource) &&
  /\.eq\(['"]id['"],\s*validCommentId\)/.test(commentLikeApiSource) &&
  /p_comment_id:\s*validCommentId/.test(commentLikeApiSource) &&
  !/p_comment_id:\s*commentId/.test(commentLikeApiSource)
const imageProxyPath = join(root, 'src/app/api/images/proxy/route.ts')
const imageProxySource = readFileSync(imageProxyPath, 'utf8')
const postViewPath = join(root, 'src/app/api/posts/[id]/view/route.ts')
const postViewSource = readFileSync(postViewPath, 'utf8')
const postDetailClientPath = join(root, 'src/app/[locale]/board/[id]/PostDetailClient.tsx')
const postDetailClientSource = readFileSync(postDetailClientPath, 'utf8')
const mypageProfilePersonalInfoPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/PersonalInfo.tsx'
)
const mypageProfilePersonalInfoSource = readFileSync(mypageProfilePersonalInfoPath, 'utf8')
const mypageProfileEditFormPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/ProfileEditForm.tsx'
)
const mypageProfileEditFormSource = readFileSync(mypageProfileEditFormPath, 'utf8')
const mypageArtistPagePath = join(root, 'src/app/[locale]/mypage/artist/page.tsx')
const mypageArtistPageSource = readFileSync(mypageArtistPagePath, 'utf8')
const validatesPostDetailAdminStatus =
  /select\(['"]is_admin,\s*registration_status,\s*is_active['"]\)/.test(postDetailSource) &&
  /prof\?\.is_admin && prof\.registration_status === ['"]approved['"] && prof\.is_active/.test(
    postDetailSource
  )
const apiWrapperPath = join(root, 'src/utils/apiWrapper.ts')
const apiWrapperSource = readFileSync(apiWrapperPath, 'utf8')
const apiResponsePath = join(root, 'src/utils/apiResponse.ts')
const apiResponseSource = readFileSync(apiResponsePath, 'utf8')
const queryParamsPath = join(root, 'src/utils/queryParams.ts')
const queryParamsSource = readFileSync(queryParamsPath, 'utf8')
const safeUrlPath = join(root, 'src/utils/safeUrl.ts')
const safeUrlSource = readFileSync(safeUrlPath, 'utf8')
const imageUrlPath = join(root, 'src/utils/imageUrl.ts')
const imageUrlSource = readFileSync(imageUrlPath, 'utf8')
const cspReportPath = join(root, 'src/app/api/security/csp-report/route.ts')
const cspReportSource = readFileSync(cspReportPath, 'utf8')
const structuredDataPath = join(root, 'src/utils/structuredData.tsx')
const structuredDataSource = readFileSync(structuredDataPath, 'utf8')
const advancedFilteringPath = join(root, 'src/utils/advancedFiltering.ts')
const advancedFilteringSource = readFileSync(advancedFilteringPath, 'utf8')
const activityLoggerPath = join(root, 'src/utils/activityLogger.ts')
const activityLoggerSource = readFileSync(activityLoggerPath, 'utf8')
const boardPagePath = join(root, 'src/app/[locale]/board/page.tsx')
const boardPageSource = readFileSync(boardPagePath, 'utf8')
const archivePagePath = join(root, 'src/app/[locale]/archive/page.tsx')
const archivePageSource = readFileSync(archivePagePath, 'utf8')
const cooperativeInfoPath = join(
  root,
  'src/app/[locale]/mypage/profile/components/CooperativeInfo.tsx'
)
const cooperativeInfoSource = readFileSync(cooperativeInfoPath, 'utf8')
const adminSettingsPagePath = join(root, 'src/app/[locale]/admin/settings/page.tsx')
const adminSettingsPageSource = readFileSync(adminSettingsPagePath, 'utf8')
const adminMembersPagePath = join(root, 'src/app/[locale]/admin/members/page.tsx')
const adminMembersPageSource = readFileSync(adminMembersPagePath, 'utf8')
const adminMembersRefreshAvoidsUrlCachebuster =
  /(?:cache:\s*|fetchOptions\.cache\s*=\s*)['"]no-store['"]/.test(adminMembersPageSource) &&
  /Cache-Control['"]?\s*:\s*['"]no-cache, no-store, must-revalidate['"]/.test(
    adminMembersPageSource
  ) &&
  !/params\.append\(['"]_t['"]/.test(adminMembersPageSource) &&
  !/_t['"]?,\s*Date\.now\(\)/.test(adminMembersPageSource)
const adminNotificationsPagePath = join(root, 'src/app/[locale]/admin/notifications/page.tsx')
const adminNotificationsPageSource = readFileSync(adminNotificationsPagePath, 'utf8')
const adminReportGeneratorPath = join(root, 'src/app/[locale]/admin/components/ReportGenerator.tsx')
const adminReportGeneratorSource = readFileSync(adminReportGeneratorPath, 'utf8')
const adminReportGenerateApiPath = join(root, 'src/app/api/admin/reports/generate/route.ts')
const adminReportGenerateApiSource = readFileSync(adminReportGenerateApiPath, 'utf8')
const recentActivityPath = join(root, 'src/app/[locale]/admin/components/RecentActivity.tsx')
const recentActivitySource = readFileSync(recentActivityPath, 'utf8')
const activityAnalyticsChartsPath = join(
  root,
  'src/app/[locale]/admin/components/ActivityAnalyticsCharts.tsx'
)
const activityAnalyticsChartsSource = readFileSync(activityAnalyticsChartsPath, 'utf8')
const mypageSecuritySettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/SecuritySettings.tsx'
)
const mypageSecuritySettingsSource = readFileSync(mypageSecuritySettingsPath, 'utf8')
const mypagePreferenceSettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/PreferenceSettings.tsx'
)
const mypagePreferenceSettingsSource = readFileSync(mypagePreferenceSettingsPath, 'utf8')
const mypageInterfaceSettingsPath = join(
  root,
  'src/app/[locale]/mypage/settings/components/InterfaceSettings.tsx'
)
const mypageInterfaceSettingsSource = readFileSync(mypageInterfaceSettingsPath, 'utf8')
const parsesApiWrapperPaginationSafely =
  /parseIntegerParam\(searchParams\.get\(['"]page['"]\),\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    apiWrapperSource
  ) &&
  /parseIntegerParam\(searchParams\.get\(['"]limit['"]\),\s*defaultLimit,\s*\{[\s\S]*?min:\s*1,[\s\S]*?max:\s*maxLimit,[\s\S]*?\}\)/.test(
    apiWrapperSource
  )
const validatesApiWrapperSortFields =
  /const safeFields = allowedFields\.length > 0 \? allowedFields : \[defaultOrderBy\]/.test(
    apiWrapperSource
  ) &&
  /if \(!safeFields\.includes\(orderBy\)\)/.test(apiWrapperSource) &&
  !/if \(allowedFields\.length > 0 && !allowedFields\.includes\(orderBy\)\)/.test(apiWrapperSource)
const avoidsApiWrapperRequireAdminNameCollision =
  /export function requireAdminRole\(userRole\?: string\): void/.test(apiWrapperSource) &&
  !/export function requireAdmin\(userRole\?: string\): void/.test(apiWrapperSource)
const parsesIntegerParamsAsWholeStrings =
  queryParamsSource.includes('/^[+-]?\\d+$/') &&
  !/const\s+parsed\s*=\s*Number\.parseInt\(value\s*\|\|/.test(queryParamsSource)
const sanitizesDownloadFilenames =
  /function sanitizeDownloadFilename/.test(apiResponseSource) &&
  /replace\(\s*\/\[\\r\\n"\]\/g,\s*['"]['"]\s*\)/.test(apiResponseSource) &&
  /replace\(\s*\/\[\\\\\/\]\/g,\s*['"]_['"]\s*\)/.test(apiResponseSource) &&
  /const safeFilename = sanitizeDownloadFilename\(filename\)/.test(apiResponseSource) &&
  /filename="\$\{safeFilename\}"/.test(apiResponseSource) &&
  /encodeURIComponent\(safeFilename\)/.test(apiResponseSource) &&
  !/filename="\$\{filename\}"/.test(apiResponseSource)
const sanitizesCspReportFields =
  /function getReportObject/.test(cspReportSource) &&
  /function sanitizeReportString/.test(cspReportSource) &&
  /function sanitizeReportNumber/.test(cspReportSource) &&
  cspReportSource.includes("const cspReport = getReportObject(report?.['csp-report'])") &&
  /sanitizeReportString\(cspReport\[['"]document-uri['"]\]\)\.replace/.test(cspReportSource) &&
  /sanitizeReportString\(cspReport\[['"]blocked-uri['"]\]\)\.replace/.test(cspReportSource) &&
  /sanitizeReportNumber\(cspReport\[['"]line-number['"]\]\)/.test(cspReportSource) &&
  /Number\.isFinite\(value\)/.test(cspReportSource) &&
  !/cspReport\[['"]document-uri['"]\]\?\.replace/.test(cspReportSource) &&
  !/lineNumber:\s*cspReport\[['"]line-number['"]\]/.test(cspReportSource)
const postsApiParsesPaginationSafely =
  /parseIntegerParam\(searchParams\.get\(['"]limit['"]\),\s*20,\s*\{\s*min:\s*1,\s*max:\s*50\s*\}\)/.test(
    postsApiSource
  ) &&
  /parseIntegerParam\(pageParam\s*\?\?\s*cursorParam,\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    postsApiSource
  ) &&
  !/Number\(pageParam\s*\|\|\s*cursorParam/.test(postsApiSource)
const boardPageParsesSearchParamsSafely =
  /parseIntegerParam\(resolved\.page\s*\?\?\s*null,\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    boardPageSource
  ) &&
  !/parseInt\(resolved\.page/.test(boardPageSource) &&
  !/Number\(resolved\.page\)/.test(boardPageSource)
const archivePageParsesSearchParamsSafely =
  /parseIntegerParam\(normalizeSingleParam\(resolvedSearch\.page\),\s*1,\s*\{\s*min:\s*1\s*\}\)/.test(
    archivePageSource
  ) &&
  !/Number\(Array\.isArray\(resolvedSearch\.page\)/.test(archivePageSource) &&
  !/Number\(normalizeSingleParam\(resolvedSearch\.page\)\)/.test(archivePageSource)
const parsesMemberFeeInputsSafely =
  /parseIntegerParam/.test(signupPageSource) &&
  /monthly_fee:\s*parseIntegerParam\(formData\.monthlyFee,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    signupPageSource
  ) &&
  !/parseInt\(formData\.monthlyFee/.test(signupPageSource) &&
  /parseIntegerParam/.test(cooperativeInfoSource) &&
  /parseIntegerParam\(e\.target\.value,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(cooperativeInfoSource) &&
  !/parseInt\(e\.target\.value\)/.test(cooperativeInfoSource)
const parsesAdminSettingNumberInputsSafely =
  /parseIntegerParam/.test(adminSettingsPageSource) &&
  [
    ['site', 'max_members'],
    ['email', 'smtp_port'],
    ['security', 'session_timeout'],
    ['security', 'max_login_attempts'],
    ['security', 'password_min_length'],
  ].every(([group, key]) =>
    new RegExp(
      `updateSettings\\([\\s\\S]*?['"]${group}['"],[\\s\\S]*?['"]${key}['"],[\\s\\S]*?parseIntegerParam\\(e\\.target\\.value,\\s*0,\\s*\\{\\s*min:\\s*0\\s*\\}\\)[\\s\\S]*?\\)`
    ).test(adminSettingsPageSource)
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminSettingsPageSource)
const parsesAdminOperationalNumberInputsSafely =
  /parseIntegerParam/.test(adminNotificationsPageSource) &&
  /expires_hours:\s*parseIntegerParam\(e\.target\.value,\s*24,\s*\{\s*min:\s*1\s*\}\)/.test(
    adminNotificationsPageSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminNotificationsPageSource) &&
  /parseIntegerParam/.test(adminReportGeneratorSource) &&
  /minimumActivity:\s*parseIntegerParam\(e\.target\.value,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    adminReportGeneratorSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(adminReportGeneratorSource) &&
  /parseIntegerParam/.test(recentActivitySource) &&
  /setDays\(parseIntegerParam\(e\.target\.value,\s*7,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    recentActivitySource
  ) &&
  /setLimit\(parseIntegerParam\(e\.target\.value,\s*10,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    recentActivitySource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(recentActivitySource) &&
  /parseIntegerParam/.test(activityAnalyticsChartsSource) &&
  /setTopK\(parseIntegerParam\(e\.target\.value,\s*8,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    activityAnalyticsChartsSource
  ) &&
  /setTrendWeeks\(parseIntegerParam\(e\.target\.value,\s*8,\s*\{\s*min:\s*1\s*\}\)\)/.test(
    activityAnalyticsChartsSource
  ) &&
  !/Number\(e\.target\.value\)/.test(activityAnalyticsChartsSource)
const avoidsAdminMembersOperationalConsoleNoise = !/console\.(?:log|debug|warn)\(/.test(
  adminMembersPageSource
)
const validatesAdminReportGenerationInputs =
  /REPORT_TYPES\s*=\s*\[/.test(adminReportGenerateApiSource) &&
  /parseReportType\(body\.reportType\)/.test(adminReportGenerateApiSource) &&
  adminReportGenerateApiSource.includes('const REPORT_DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/') &&
  /parseReportDateRange\(body\.dateRange\)/.test(adminReportGenerateApiSource) &&
  /MAX_REPORT_RANGE_DAYS/.test(adminReportGenerateApiSource) &&
  /startDate > endDate/.test(adminReportGenerateApiSource) &&
  /parseReportFilters\(body\.filters\)/.test(adminReportGenerateApiSource) &&
  /parseIntegerParam\(String\(raw\.minimumActivity \?\? ['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    adminReportGenerateApiSource
  ) &&
  /filters,/.test(adminReportGenerateApiSource) &&
  !/const reportType = typeof body\.reportType === ['"]string['"] \? body\.reportType : ['"]['"]/.test(
    adminReportGenerateApiSource
  ) &&
  !/new Date\(dateRange\.start\)/.test(adminReportGenerateApiSource) &&
  !/const filters = body\.filters/.test(adminReportGenerateApiSource)
const parsesMypageSettingNumberInputsSafely =
  /parseIntegerParam/.test(mypageSecuritySettingsSource) &&
  /minutes:\s*parseIntegerParam\(e\.target\.value,\s*480,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypageSecuritySettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypageSecuritySettingsSource) &&
  /parseIntegerParam/.test(mypagePreferenceSettingsSource) &&
  /interval_minutes:\s*parseIntegerParam\(e\.target\.value,\s*5,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypagePreferenceSettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypagePreferenceSettingsSource) &&
  /parseIntegerParam/.test(mypageInterfaceSettingsSource) &&
  /items_per_page:\s*parseIntegerParam\(e\.target\.value,\s*20,\s*\{\s*min:\s*1\s*\}\)/.test(
    mypageInterfaceSettingsSource
  ) &&
  !/parseInt\(e\.target\.value\)/.test(mypageInterfaceSettingsSource)
const parsesPostViewTimestampsSafely =
  /parseIntegerParam/.test(postDetailClientSource) &&
  /const\s+parsedLastViewTime\s*=\s*lastViewTime\s*\?\s*parseIntegerParam\(lastViewTime,\s*0,\s*\{\s*min:\s*0\s*\}\)\s*:\s*0/.test(
    postDetailClientSource
  ) &&
  !/parseInt\(lastViewTime\)/.test(postDetailClientSource) &&
  /parseIntegerParam/.test(postViewSource) &&
  /parseIntegerParam\(lastViewTime,\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(postViewSource) &&
  !/parseInt\(lastViewTime\)/.test(postViewSource)
const parsesImageProxyContentLengthSafely =
  /parseIntegerParam/.test(imageProxySource) &&
  /parseIntegerParam\(res\.headers\.get\(['"]content-length['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    imageProxySource
  ) &&
  !/Number\(res\.headers\.get\(['"]content-length['"]\)/.test(imageProxySource)
const parsesAttachmentSizesSafely =
  /parseIntegerParam/.test(boardPostDetailSource) &&
  /parseIntegerParam\(String\(att\.file_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    boardPostDetailSource
  ) &&
  !/Number\(att\.file_size\)/.test(boardPostDetailSource) &&
  /parseIntegerParam/.test(serverBoardSource) &&
  /parseIntegerParam\(String\(row\.file_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    serverBoardSource
  ) &&
  !/Number\(row\.file_size\)/.test(serverBoardSource) &&
  /parseIntegerParam/.test(boardDetailPageSource) &&
  /parseIntegerParam\(String\(att\.file_size\s*\?\?\s*['"]['"]\),\s*0,\s*\{\s*min:\s*0\s*\}\)/.test(
    boardDetailPageSource
  ) &&
  !/att\.file_size\s*\|\|\s*0/.test(boardDetailPageSource)
const validatesRenderedArtistProfilePhotoUrls =
  /isProjectStoragePublicUrl/.test(postDetailClientSource) &&
  /const\s+safeAuthorProfilePhotoUrl\s*=[\s\S]*?isProjectStoragePublicUrl\([\s\S]*?authorProfile\.profile_photo_url,[\s\S]*?['"]artists['"],[\s\S]*?authorProfile\.id[\s\S]*?\)/.test(
    postDetailClientSource
  ) &&
  !/src=\{authorProfile\.profile_photo_url\}/.test(postDetailClientSource) &&
  /artistId\?:\s*string\s*\|\s*null/.test(mypageProfilePersonalInfoSource) &&
  /isProjectStoragePublicUrl/.test(mypageProfilePersonalInfoSource) &&
  /isProjectStoragePublicUrl\(artistPhotoUrl,\s*['"]artists['"],\s*artistId\)/.test(
    mypageProfilePersonalInfoSource
  ) &&
  !/src=\{artistPhotoUrl\}/.test(mypageProfilePersonalInfoSource) &&
  /artistId=\{artistData\?\.id \|\| null\}/.test(mypageProfileEditFormSource) &&
  /safePreviewImageForDisplay/.test(mypageArtistPageSource) &&
  /isProjectStoragePublicUrl\(previewImageForDisplay,\s*['"]artists['"],\s*artist\.id\)/.test(
    mypageArtistPageSource
  ) &&
  !/src=\{previewImageForDisplay\}/.test(mypageArtistPageSource)
const profileEditFormGuardsArtistFetchUnmount =
  /let mounted = true/.test(mypageProfileEditFormSource) &&
  /if \(mounted\) \{\s*setArtistData\(data\.artist\)\s*\}/.test(mypageProfileEditFormSource) &&
  /if \(mounted\) \{\s*setArtistLoading\(false\)\s*\}/.test(mypageProfileEditFormSource) &&
  /return \(\) => \{\s*mounted = false\s*\}/.test(mypageProfileEditFormSource)
const validatesAdvancedFilterFiniteNumbers =
  /Number\.isFinite\(num\)/.test(advancedFilteringSource) &&
  !/isNaN\(num\)\s*\?\s*null\s*:\s*num/.test(advancedFilteringSource)
const validatesAdvancedSearchSqlAllowlists =
  /Sort fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Filter fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Search fields require an explicit allowlist/.test(advancedFilteringSource) &&
  /Disallowed search fields/.test(advancedFilteringSource) &&
  /Invalid pagination values/.test(advancedFilteringSource) &&
  /buildOrderByClause\(query\.sorts,\s*allowedFields\)/.test(advancedFilteringSource) &&
  !/allowedFields\.length === 0 \|\| allowedFields\.includes\(field\)/.test(
    advancedFilteringSource
  ) &&
  !/allowedFields\.length > 0 && !allowedFields\.includes\(sort\.field\)/.test(
    advancedFilteringSource
  )
const parsesSessionPingIntervalSafely =
  /parseIntegerParam/.test(activityLoggerSource) &&
  /parseIntegerParam\(process\.env\.NEXT_PUBLIC_SESSION_PING_MS\s*\?\?\s*null,\s*90000,\s*\{[\s\S]*?min:\s*1000,[\s\S]*?\}\)/.test(
    activityLoggerSource
  ) &&
  !/Number\(process\.env\.NEXT_PUBLIC_SESSION_PING_MS/.test(activityLoggerSource) &&
  !/isNaN\(pingMs\)/.test(activityLoggerSource)
const authRedirectBlocklistHandlesLocalePrefixes =
  /stripSupportedLocalePrefix/.test(safeUrlSource) &&
  /const\s+redirectPathname\s*=\s*stripSupportedLocalePrefix\(path\)/.test(safeUrlSource) &&
  /AUTH_REDIRECT_BLOCKLIST\.some\([\s\S]*?redirectPathname\s*===\s*blocked[\s\S]*?redirectPathname\.startsWith\(`\$\{blocked\}\/`\)/.test(
    safeUrlSource
  )
const adminActivitiesUsersPath = join(root, 'src/app/api/admin/activities/users/route.ts')
const adminActivitiesUsersSource = readFileSync(adminActivitiesUsersPath, 'utf8')
const activityLogPath = join(root, 'src/app/api/activities/log/route.ts')
const activityLogSource = readFileSync(activityLogPath, 'utf8')
const activityBatchLogPath = join(root, 'src/app/api/activities/batch-log/route.ts')
const activityBatchLogSource = readFileSync(activityBatchLogPath, 'utf8')
const adminAnalyticsPatternsPath = join(root, 'src/app/api/admin/analytics/patterns/route.ts')
const adminAnalyticsPatternsSource = readFileSync(adminAnalyticsPatternsPath, 'utf8')
const adminAnalyticsTrendsPath = join(root, 'src/app/api/admin/analytics/trends/route.ts')
const adminAnalyticsTrendsSource = readFileSync(adminAnalyticsTrendsPath, 'utf8')
const adminPerformancePath = join(root, 'src/app/api/admin/performance/route.ts')
const adminPerformanceSource = readFileSync(adminPerformancePath, 'utf8')
const adminStatsPath = join(root, 'src/app/api/admin/stats/route.ts')
const adminStatsSource = readFileSync(adminStatsPath, 'utf8')
const adminStatsMonthlyPath = join(root, 'src/app/api/admin/stats/monthly/route.ts')
const adminStatsMonthlySource = readFileSync(adminStatsMonthlyPath, 'utf8')
const adminMembersStatsPath = join(root, 'src/app/api/admin/members/stats/route.ts')
const adminMembersStatsSource = readFileSync(adminMembersStatsPath, 'utf8')
const adminPostsStatsPath = join(root, 'src/app/api/admin/posts/stats/route.ts')
const adminPostsStatsSource = readFileSync(adminPostsStatsPath, 'utf8')
const adminActivityPath = join(root, 'src/app/api/admin/activity/route.ts')
const adminActivitySource = readFileSync(adminActivityPath, 'utf8')
const adminArtistsPath = join(root, 'src/app/api/admin/artists/route.ts')
const adminArtistsSource = readFileSync(adminArtistsPath, 'utf8')
const adminArtistsMembersPath = join(root, 'src/app/api/admin/artists/members/route.ts')
const adminArtistsMembersSource = readFileSync(adminArtistsMembersPath, 'utf8')
const adminMembersPath = join(root, 'src/app/api/admin/members/route.ts')
const adminMembersSource = readFileSync(adminMembersPath, 'utf8')
const adminPostsPath = join(root, 'src/app/api/admin/posts/route.ts')
const adminPostsSource = readFileSync(adminPostsPath, 'utf8')
const adminReportsGeneratePath = join(root, 'src/app/api/admin/reports/generate/route.ts')
const adminReportsGenerateSource = readFileSync(adminReportsGeneratePath, 'utf8')
const adminActivitiesRealTimePath = join(root, 'src/app/api/admin/activities/real-time/route.ts')
const adminActivitiesRealTimeSource = readFileSync(adminActivitiesRealTimePath, 'utf8')
const apiPerformanceMonitorPath = join(root, 'src/utils/apiPerformanceMonitor.ts')
const apiPerformanceMonitorSource = readFileSync(apiPerformanceMonitorPath, 'utf8')
const adminAnalyticsConstantsPath = join(root, 'src/constants/adminAnalytics.ts')
const adminAnalyticsConstantsSource = readFileSync(adminAnalyticsConstantsPath, 'utf8')
const userSettingsConstantsPath = join(root, 'src/constants/userSettings.ts')
const userSettingsConstantsSource = readFileSync(userSettingsConstantsPath, 'utf8')
const userSettingsApiPath = join(root, 'src/app/api/settings/route.ts')
const userSettingsApiSource = readFileSync(userSettingsApiPath, 'utf8')
const userSettingsResetApiPath = join(root, 'src/app/api/settings/reset/route.ts')
const userSettingsResetApiSource = readFileSync(userSettingsResetApiPath, 'utf8')
const activityConstantsPath = join(root, 'src/constants/activity.ts')
const activityConstantsSource = readFileSync(activityConstantsPath, 'utf8')
const validatesAdminAnalyticsUserIdFilters =
  /validateUUID/.test(adminActivitiesUsersSource) &&
  /let\s+sanitizedUserId[\s\S]*?=\s*null/.test(adminActivitiesUsersSource) &&
  /query\.eq\(['"]user_id['"],\s*sanitizedUserId\)/.test(adminActivitiesUsersSource) &&
  /validateUUID/.test(adminAnalyticsPatternsSource) &&
  /let\s+sanitizedUserId[\s\S]*?=\s*null/.test(adminAnalyticsPatternsSource) &&
  /analyzeActivityPatterns\([\s\S]*?db,[\s\S]*?sanitizedUserId/.test(adminAnalyticsPatternsSource)
const validatesAdminAnalyticsQueryEnums =
  /TREND_PERIODS/.test(adminAnalyticsConstantsSource) &&
  /TREND_TYPES/.test(adminAnalyticsConstantsSource) &&
  /PERFORMANCE_ACTIONS/.test(adminAnalyticsConstantsSource) &&
  /parseTrendPeriod/.test(adminAnalyticsConstantsSource) &&
  /parseTrendType/.test(adminAnalyticsConstantsSource) &&
  /parsePerformanceAction/.test(adminAnalyticsConstantsSource) &&
  /const periodParam = searchParams\.get\(['"]period['"]\) \|\| ['"]daily['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  /const period = parseTrendPeriod\(periodParam\)/.test(adminAnalyticsTrendsSource) &&
  /const trendTypeParam = searchParams\.get\(['"]type['"]\) \|\| ['"]activity['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  /const trendType = parseTrendType\(trendTypeParam\)/.test(adminAnalyticsTrendsSource) &&
  /if\s*\(!period\)/.test(adminAnalyticsTrendsSource) &&
  /if\s*\(!trendType\)/.test(adminAnalyticsTrendsSource) &&
  /const actionParam = searchParams\.get\(['"]action['"]\) \|\| ['"]dashboard['"]/.test(
    adminPerformanceSource
  ) &&
  /const action = parsePerformanceAction\(actionParam\)/.test(adminPerformanceSource) &&
  /if\s*\(!action\)/.test(adminPerformanceSource) &&
  !/const period = searchParams\.get\(['"]period['"]\) \|\| ['"]daily['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  !/const trendType = searchParams\.get\(['"]type['"]\) \|\| ['"]activity['"]/.test(
    adminAnalyticsTrendsSource
  ) &&
  !/const action = searchParams\.get\(['"]action['"]\) \|\| ['"]dashboard['"]/.test(
    adminPerformanceSource
  )
const validatesAdminPerformanceExportDates =
  /MAX_EXPORT_RANGE_MS/.test(adminPerformanceSource) &&
  /function parseMetricTimestamp/.test(adminPerformanceSource) &&
  /Date\.parse\(value\)/.test(adminPerformanceSource) &&
  /Number\.isFinite\(parsed\)/.test(adminPerformanceSource) &&
  /parsedStartTime === null \|\| parsedEndTime === null/.test(adminPerformanceSource) &&
  /parsedStartTime > parsedEndTime/.test(adminPerformanceSource) &&
  /parsedEndTime - parsedStartTime > MAX_EXPORT_RANGE_MS/.test(adminPerformanceSource) &&
  /new Date\(parsedStartTime\)\.toISOString\(\)/.test(adminPerformanceSource) &&
  /new Date\(parsedEndTime\)\.toISOString\(\)/.test(adminPerformanceSource) &&
  !/exportApiMetrics\(startTime,\s*endTime/.test(adminPerformanceSource)
const validatesUserSettingsAllowlists =
  /USER_SETTING_CATEGORIES/.test(userSettingsConstantsSource) &&
  /USER_SETTING_KEYS/.test(userSettingsConstantsSource) &&
  /parseUserSettingCategory/.test(userSettingsConstantsSource) &&
  /isUserSettingKey/.test(userSettingsConstantsSource) &&
  /satisfies\s+readonly\s+SettingCategory\[\]/.test(userSettingsConstantsSource) &&
  /parseUserSettingCategory\(categoryParam\)/.test(userSettingsApiSource) &&
  /parseJsonObjectBody/.test(userSettingsApiSource) &&
  !/request\.json\(\)/.test(userSettingsApiSource) &&
  /if\s*\(categoryParam && !category\)/.test(userSettingsApiSource) &&
  /isUserSettingKey\(category,\s*setting_key\)/.test(userSettingsApiSource) &&
  /p_category:\s*category/.test(userSettingsApiSource) &&
  /p_setting_key:\s*setting_key/.test(userSettingsApiSource) &&
  /parseUserSettingCategory\(parsed\.data\.category\)/.test(userSettingsResetApiSource) &&
  /if\s*\(parsed\.data\.category && !category\)/.test(userSettingsResetApiSource) &&
  /if\s*\(setting_key && !category\)/.test(userSettingsResetApiSource) &&
  /isUserSettingKey\(category,\s*setting_key\)/.test(userSettingsResetApiSource) &&
  !/const category = searchParams\.get\(['"]category['"]\)/.test(userSettingsApiSource) &&
  !/category:\s*z\.string\(\)\.min\(1\)\.max\(64\),/.test(userSettingsApiSource)
const validatesAdminActivityTypeFilters =
  /ACTIVITY_ACTION_TYPES/.test(activityConstantsSource) &&
  /ACTIVITY_TARGET_TYPES/.test(activityConstantsSource) &&
  /parseActivityActionType/.test(activityConstantsSource) &&
  /parseActivityTargetType/.test(activityConstantsSource) &&
  /satisfies\s+readonly\s+ActivityActionType\[\]/.test(activityConstantsSource) &&
  /satisfies\s+readonly\s+ActivityTargetType\[\]/.test(activityConstantsSource) &&
  /parseActivityActionType\(actionTypeParam\)/.test(adminActivitiesUsersSource) &&
  /parseActivityTargetType\(targetTypeParam\)/.test(adminActivitiesUsersSource) &&
  /if\s*\(actionTypeParam && !actionType\)/.test(adminActivitiesUsersSource) &&
  /if\s*\(targetTypeParam && !targetType\)/.test(adminActivitiesUsersSource) &&
  /query = query\.eq\(['"]action_type['"],\s*actionType\)/.test(adminActivitiesUsersSource) &&
  /query = query\.eq\(['"]target_type['"],\s*targetType\)/.test(adminActivitiesUsersSource) &&
  !/const actionType = searchParams\.get\(['"]action_type['"]\)/.test(adminActivitiesUsersSource) &&
  !/const targetType = searchParams\.get\(['"]target_type['"]\)/.test(adminActivitiesUsersSource)
const adminActivitiesUsersUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminActivitiesUsersSource) &&
  /export const GET = defineApiRoute/.test(adminActivitiesUsersSource) &&
  /auth:\s*['"]admin['"]/.test(adminActivitiesUsersSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminActivitiesUsersSource) &&
  !/withRateLimit\(/.test(adminActivitiesUsersSource) &&
  !/requireAdmin\(\)/.test(adminActivitiesUsersSource)
const adminAnalyticsRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminAnalyticsPatternsSource) &&
  /export const GET = defineApiRoute/.test(adminAnalyticsPatternsSource) &&
  /auth:\s*['"]admin['"]/.test(adminAnalyticsPatternsSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminAnalyticsPatternsSource) &&
  !/withRateLimit\(/.test(adminAnalyticsPatternsSource) &&
  !/requireAdmin\(\)/.test(adminAnalyticsPatternsSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminAnalyticsTrendsSource) &&
  /export const GET = defineApiRoute/.test(adminAnalyticsTrendsSource) &&
  /auth:\s*['"]admin['"]/.test(adminAnalyticsTrendsSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminAnalyticsTrendsSource) &&
  !/withRateLimit\(/.test(adminAnalyticsTrendsSource) &&
  !/requireAdmin\(\)/.test(adminAnalyticsTrendsSource)
const adminStatsRouteSources = [
  { path: adminStatsPath, source: adminStatsSource, rateLimitKey: 'admin_stats' },
  {
    path: adminStatsMonthlyPath,
    source: adminStatsMonthlySource,
    rateLimitKey: 'admin_stats_monthly',
  },
  {
    path: adminMembersStatsPath,
    source: adminMembersStatsSource,
    rateLimitKey: 'admin_members_stats',
  },
  { path: adminPostsStatsPath, source: adminPostsStatsSource, rateLimitKey: 'admin_posts_stats' },
]
const adminStatsRoutesUseSharedApiRoute = adminStatsRouteSources.every(
  ({ source, rateLimitKey }) =>
    /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(source) &&
    /export const GET = defineApiRoute/.test(source) &&
    /auth:\s*['"]admin['"]/.test(source) &&
    /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(source) &&
    new RegExp(`createUserKeyGenerator\\(['"]${rateLimitKey}['"]\\)`).test(source) &&
    /rateLimitHeaders:\s*true/.test(source) &&
    !/applyRateLimit\(/.test(source) &&
    !/addRateLimitHeaders/.test(source) &&
    !/requireAdmin\(\)/.test(source)
)
const adminListingRouteSources = [
  { path: adminActivityPath, source: adminActivitySource, rateLimitKey: 'admin_activity' },
  { path: adminArtistsPath, source: adminArtistsSource, rateLimitKey: 'admin_artists' },
  {
    path: adminArtistsMembersPath,
    source: adminArtistsMembersSource,
    rateLimitKey: 'admin_artists_members',
  },
  { path: adminMembersPath, source: adminMembersSource, rateLimitKey: 'admin_members' },
  { path: adminPostsPath, source: adminPostsSource, rateLimitKey: 'admin_posts' },
]
const adminListingRoutesUseSharedApiRoute = adminListingRouteSources.every(
  ({ source, rateLimitKey }) =>
    /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(source) &&
    /export const GET = defineApiRoute/.test(source) &&
    /auth:\s*['"]admin['"]/.test(source) &&
    /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(source) &&
    new RegExp(`createUserKeyGenerator\\(['"]${rateLimitKey}['"]\\)`).test(source) &&
    /rateLimitHeaders:\s*true/.test(source) &&
    !/applyRateLimit\(/.test(source) &&
    !/addRateLimitHeaders/.test(source) &&
    !/requireAdmin\(\)/.test(source)
)
const adminStandaloneRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminPerformanceSource) &&
  /export const GET = defineApiRoute/.test(adminPerformanceSource) &&
  /auth:\s*['"]admin['"]/.test(adminPerformanceSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminPerformanceSource) &&
  /createUserKeyGenerator\(['"]admin_performance['"]\)/.test(adminPerformanceSource) &&
  /rateLimitHeaders:\s*true/.test(adminPerformanceSource) &&
  !/applyRateLimit\(/.test(adminPerformanceSource) &&
  !/addRateLimitHeaders/.test(adminPerformanceSource) &&
  !/requireAdmin\(\)/.test(adminPerformanceSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminActivitiesRealTimeSource) &&
  /export const GET = defineApiRoute/.test(adminActivitiesRealTimeSource) &&
  /auth:\s*['"]admin['"]/.test(adminActivitiesRealTimeSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminActivitiesRealTimeSource) &&
  !/withRateLimit\(/.test(adminActivitiesRealTimeSource) &&
  !/requireAdmin\(\)/.test(adminActivitiesRealTimeSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminReportsGenerateSource) &&
  /export const POST = defineApiRoute/.test(adminReportsGenerateSource) &&
  /auth:\s*['"]admin['"]/.test(adminReportsGenerateSource) &&
  /rateLimit:\s*RATE_LIMITS\.ADMIN_API/.test(adminReportsGenerateSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminReportsGenerateSource) &&
  !/parseJsonObjectBody/.test(adminReportsGenerateSource) &&
  !/applyRateLimit\(/.test(adminReportsGenerateSource) &&
  !/requireAdmin\(\)/.test(adminReportsGenerateSource)
const adminEventApplicationsUsesSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminEventApplicationsApiSource) &&
  /export const GET = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const PATCH = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const PUT = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  /export const DELETE = defineApiRoute/.test(adminEventApplicationsApiSource) &&
  (adminEventApplicationsApiSource.match(/auth:\s*['"]admin['"]/g) ?? []).length >= 4 &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminEventApplicationsApiSource) &&
  !/parseJsonObjectBody/.test(adminEventApplicationsApiSource) &&
  !/requireAdmin\(\)/.test(adminEventApplicationsApiSource)
const adminMemberMutationRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMemberActionApiSource) &&
  /export const POST = defineApiRoute/.test(adminMemberActionApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminMemberActionApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMemberActionApiSource) &&
  /createUserKeyGenerator\(['"]admin_member_action['"]\)/.test(adminMemberActionApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminMemberActionApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMemberActionApiSource) &&
  !/parseJsonObjectBody/.test(adminMemberActionApiSource) &&
  !/applyRateLimit\(/.test(adminMemberActionApiSource) &&
  !/addRateLimitHeaders/.test(adminMemberActionApiSource) &&
  !/requireAdmin\(\)/.test(adminMemberActionApiSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminMemberFlagsApiSource) &&
  /export const PATCH = defineApiRoute/.test(adminMemberFlagsApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminMemberFlagsApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminMemberFlagsApiSource) &&
  /createUserKeyGenerator\(['"]admin_member_flags['"]\)/.test(adminMemberFlagsApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminMemberFlagsApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminMemberFlagsApiSource) &&
  !/parseJsonObjectBody/.test(adminMemberFlagsApiSource) &&
  !/applyRateLimit\(/.test(adminMemberFlagsApiSource) &&
  !/addRateLimitHeaders/.test(adminMemberFlagsApiSource) &&
  !/requireAdmin\(\)/.test(adminMemberFlagsApiSource)
const adminArtistMemberMutationRoutesUseSharedApiRoute =
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminArtistMembersApiSource) &&
  /export const POST = defineApiRoute/.test(adminArtistMembersApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminArtistMembersApiSource) &&
  /params/.test(adminArtistMembersApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminArtistMembersApiSource) &&
  /createUserKeyGenerator\(['"]admin_artists_id_members['"]\)/.test(adminArtistMembersApiSource) &&
  /rateLimitHeaders:\s*true/.test(adminArtistMembersApiSource) &&
  /body:\s*\{[\s\S]*?invalidResponse/.test(adminArtistMembersApiSource) &&
  !/parseJsonObjectBody/.test(adminArtistMembersApiSource) &&
  !/applyRateLimit\(/.test(adminArtistMembersApiSource) &&
  !/addRateLimitHeaders/.test(adminArtistMembersApiSource) &&
  !/requireAdmin\(\)/.test(adminArtistMembersApiSource) &&
  /from\s+['"]@\/lib\/server\/apiRoute['"]/.test(adminArtistMemberApiSource) &&
  /export const DELETE = defineApiRoute/.test(adminArtistMemberApiSource) &&
  /auth:\s*['"]admin['"]/.test(adminArtistMemberApiSource) &&
  /params/.test(adminArtistMemberApiSource) &&
  /rateLimit:\s*\{\s*\.\.\.RATE_LIMITS\.ADMIN_API/.test(adminArtistMemberApiSource) &&
  /createUserKeyGenerator\(['"]admin_artists_member_action['"]\)/.test(
    adminArtistMemberApiSource
  ) &&
  /rateLimitHeaders:\s*true/.test(adminArtistMemberApiSource) &&
  !/applyRateLimit\(/.test(adminArtistMemberApiSource) &&
  !/addRateLimitHeaders/.test(adminArtistMemberApiSource) &&
  !/requireAdmin\(\)/.test(adminArtistMemberApiSource)
const validatesActivityLogTypes =
  /parseActivityActionType\(action_type\)/.test(activityLogSource) &&
  /parseActivityTargetType\(target_type\)/.test(activityLogSource) &&
  /validateUUID\(target_id,\s*['"]대상 ID['"]\)/.test(activityLogSource) &&
  /p_action_type:\s*actionType/.test(activityLogSource) &&
  /p_target_type:\s*targetType/.test(activityLogSource) &&
  /p_target_id:\s*targetId/.test(activityLogSource) &&
  /parseActivityActionType\(log\.action_type\)/.test(activityBatchLogSource) &&
  /parseActivityTargetType\(log\.target_type\)/.test(activityBatchLogSource) &&
  /validateUUID\(log\.target_id,\s*['"]대상 ID['"]\)/.test(activityBatchLogSource) &&
  /p_action_type:\s*actionType/.test(activityBatchLogSource) &&
  /p_target_type:\s*targetType/.test(activityBatchLogSource) &&
  /p_target_id:\s*targetId/.test(activityBatchLogSource) &&
  /target_type:\s*['"]system['"]/.test(loginPageSource) &&
  !/target_type:\s*['"]auth['"]/.test(loginPageSource) &&
  !/p_action_type:\s*action_type/.test(activityLogSource) &&
  !/p_target_type:\s*target_type/.test(activityLogSource) &&
  !/p_target_id:\s*target_id/.test(activityLogSource) &&
  !/p_action_type:\s*log\.action_type/.test(activityBatchLogSource) &&
  !/p_target_type:\s*log\.target_type/.test(activityBatchLogSource) &&
  !/p_target_id:\s*log\.target_id/.test(activityBatchLogSource)
const boardRoomDynamicRouteChecks = [
  {
    path: 'src/app/api/board-room/meetings/[id]/route.ts',
    label: '회의 ID',
    methods: ['GET', 'PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/agendas/[id]/route.ts',
    label: '안건 ID',
    methods: ['PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/minutes/[id]/route.ts',
    label: '회의록 ID',
    methods: ['PATCH', 'DELETE'],
  },
  {
    path: 'src/app/api/board-room/documents/[id]/route.ts',
    label: '서류 ID',
    methods: ['DELETE'],
  },
].filter(({ path: routePath, label, methods }) => {
  const source = readFileSync(join(root, routePath), 'utf8')
  return !(
    /validateUUID/.test(source) &&
    source.includes(label) &&
    methods.every(method =>
      new RegExp(
        `export\\s+async\\s+function\\s+${method}[\\s\\S]*?validate[A-Za-z]+Id\\(params\\.id\\)[\\s\\S]*?const\\s+id\\s*=\\s*routeId\\.id`
      ).test(source)
    )
  )
})
const boardRoomAttendeesPath = join(root, 'src/app/api/board-room/attendees/route.ts')
const boardRoomAttendeesSource = readFileSync(boardRoomAttendeesPath, 'utf8')
const boardRoomConstantsPath = join(root, 'src/constants/boardRoom.ts')
const boardRoomConstantsSource = readFileSync(boardRoomConstantsPath, 'utf8')
const boardRoomMeetingsPath = join(root, 'src/app/api/board-room/meetings/route.ts')
const boardRoomMeetingsSource = readFileSync(boardRoomMeetingsPath, 'utf8')
const boardRoomMeetingDetailPath = join(root, 'src/app/api/board-room/meetings/[id]/route.ts')
const boardRoomMeetingDetailSource = readFileSync(boardRoomMeetingDetailPath, 'utf8')
const boardRoomAgendaDetailPath = join(root, 'src/app/api/board-room/agendas/[id]/route.ts')
const boardRoomAgendaDetailSource = readFileSync(boardRoomAgendaDetailPath, 'utf8')
const boardRoomMinutesPath = join(root, 'src/app/api/board-room/minutes/route.ts')
const boardRoomMinutesSource = readFileSync(boardRoomMinutesPath, 'utf8')
const boardRoomMinutesDetailPath = join(root, 'src/app/api/board-room/minutes/[id]/route.ts')
const boardRoomMinutesDetailSource = readFileSync(boardRoomMinutesDetailPath, 'utf8')
const contentFormatConstantsPath = join(root, 'src/constants/contentFormat.ts')
const contentFormatConstantsSource = readFileSync(contentFormatConstantsPath, 'utf8')
const validatesBoardRoomAttendeesMeetingId =
  /validateUUID/.test(boardRoomAttendeesSource) &&
  /validateMeetingId/.test(boardRoomAttendeesSource) &&
  /validateMemberId/.test(boardRoomAttendeesSource) &&
  /const\s+routeMeetingId\s*=\s*validateMeetingId\(meetingId\)/.test(boardRoomAttendeesSource) &&
  /const\s+sanitizedMeetingId\s*=\s*routeMeetingId\.id/.test(boardRoomAttendeesSource) &&
  /\.eq\(['"]meeting_id['"],\s*sanitizedMeetingId\)/.test(boardRoomAttendeesSource) &&
  /meeting_id:\s*sanitizedMeetingId/.test(boardRoomAttendeesSource) &&
  /const\s+memberId\s*=\s*validateMemberId\(r\.member_id\)/.test(boardRoomAttendeesSource) &&
  /member_id:\s*memberId\.id/.test(boardRoomAttendeesSource)
const validatesBoardRoomMinutesContentFormat =
  /CONTENT_FORMATS\s*=\s*\[['"]plain['"],\s*['"]html['"],\s*['"]markdown['"]\]\s+as const/.test(
    contentFormatConstantsSource
  ) &&
  /parseContentFormat/.test(contentFormatConstantsSource) &&
  /parseContentFormat\(body\.content_format\)/.test(boardRoomMinutesSource) &&
  /content_format:\s*contentFormat/.test(boardRoomMinutesSource) &&
  /parseContentFormat\(body\.content_format\)/.test(boardRoomMinutesDetailSource) &&
  /update\.content_format = contentFormat/.test(boardRoomMinutesDetailSource) &&
  !/update\.content_format = body\.content_format/.test(boardRoomMinutesDetailSource) &&
  !/content_format:\s*body\.content_format/.test(boardRoomMinutesSource)
const validatesBoardRoomMeetingDateInputs =
  /parseBoardMeetingDate/.test(boardRoomConstantsSource) &&
  /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingDeadline/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingCandidateDates/.test(boardRoomConstantsSource) &&
  /MAX_BOARD_MEETING_CANDIDATE_DATES/.test(boardRoomConstantsSource) &&
  /parseBoardMeetingCandidateDates\(body\.candidate_dates\)/.test(boardRoomMeetingsSource) &&
  /parseBoardMeetingDeadline\(body\.vote_deadline\)/.test(boardRoomMeetingsSource) &&
  /parseBoardMeetingDeadline\(body\.vote_deadline\)/.test(boardRoomMeetingDetailSource) &&
  /const confirmDate = parseBoardMeetingDate\(body\.confirm_date\)/.test(
    boardRoomMeetingDetailSource
  ) &&
  /\.eq\(['"]candidate_date['"],\s*confirmDate\)/.test(boardRoomMeetingDetailSource) &&
  /update\.meeting_date = confirmDate/.test(boardRoomMeetingDetailSource) &&
  /body\.status !== undefined/.test(boardRoomMeetingDetailSource) &&
  /BOARD_MEETING_STATUS/.test(boardRoomMeetingDetailSource) &&
  !/filter\(\(date\): date is string => typeof date === ['"]string['"]\)/.test(
    boardRoomMeetingsSource
  ) &&
  !/vote_deadline = body\.vote_deadline/.test(boardRoomMeetingDetailSource) &&
  !/\.eq\(['"]candidate_date['"],\s*body\.confirm_date\)/.test(boardRoomMeetingDetailSource)
const validatesBoardRoomAgendaSortOrder =
  /parseBoardAgendaSortOrder/.test(boardRoomConstantsSource) &&
  /Number\.isInteger\(value\)/.test(boardRoomConstantsSource) &&
  /MAX_BOARD_AGENDA_SORT_ORDER/.test(boardRoomConstantsSource) &&
  /parseBoardAgendaSortOrder\(body\.sort_order\)/.test(boardRoomAgendaDetailSource) &&
  /update\.sort_order = sortOrder/.test(boardRoomAgendaDetailSource) &&
  !/update\.sort_order = body\.sort_order/.test(boardRoomAgendaDetailSource)
const boardRoomCreateRouteIdChecks = [
  {
    path: 'src/app/api/board-room/agendas/route.ts',
    idLabel: '회의 ID',
    rawName: 'meetingId',
    sanitizedName: 'sanitizedMeetingId',
    dbColumn: 'meeting_id',
  },
  {
    path: 'src/app/api/board-room/minutes/route.ts',
    idLabel: '회의 ID',
    rawName: 'meetingId',
    sanitizedName: 'sanitizedMeetingId',
    dbColumn: 'meeting_id',
  },
  {
    path: 'src/app/api/board-room/date-votes/route.ts',
    idLabel: '후보 날짜 ID',
    rawName: 'optionId',
    sanitizedName: 'sanitizedOptionId',
    dbColumn: 'option_id',
    lookupColumn: 'id',
  },
].filter(({ path: routePath, idLabel, rawName, sanitizedName, dbColumn, lookupColumn }) => {
  const source = readFileSync(join(root, routePath), 'utf8')
  const expectedLookupColumn = lookupColumn ?? dbColumn
  return !(
    /validateUUID/.test(source) &&
    source.includes(idLabel) &&
    new RegExp(`validate[A-Za-z]+Id\\(${rawName}\\)`).test(source) &&
    new RegExp(`const\\s+${sanitizedName}\\s*=`).test(source) &&
    new RegExp(`${dbColumn}:\\s*${sanitizedName}`).test(source) &&
    new RegExp(`\\.eq\\(['"]${expectedLookupColumn}['"],\\s*${sanitizedName}\\)`).test(source)
  )
})
const articleCardPath = join(root, 'src/components/ArticleCard.tsx')
const articleCardSource = readFileSync(articleCardPath, 'utf8')
const ticketingCardPath = join(root, 'src/components/TicketingCard.tsx')
const ticketingCardSource = readFileSync(ticketingCardPath, 'utf8')
const featuredProjectsPath = join(root, 'src/components/FeaturedProjects.tsx')
const featuredProjectsSource = readFileSync(featuredProjectsPath, 'utf8')
const featuredArtistsPath = join(root, 'src/components/FeaturedArtists.tsx')
const featuredArtistsSource = readFileSync(featuredArtistsPath, 'utf8')
const artistProjectsPath = join(root, 'src/components/ArtistProjects.tsx')
const artistProjectsSource = readFileSync(artistProjectsPath, 'utf8')
const baseCardPath = join(root, 'src/components/common/BaseCard.tsx')
const baseCardSource = readFileSync(baseCardPath, 'utf8')
const lightboxPath = join(root, 'src/components/Lightbox.tsx')
const lightboxSource = readFileSync(lightboxPath, 'utf8')
const optimizedImagePath = join(root, 'src/components/OptimizedImage.tsx')
const optimizedImageSource = readFileSync(optimizedImagePath, 'utf8')
const archiveContentPath = join(root, 'src/app/[locale]/archive/ArchiveContent.tsx')
const archiveContentSource = readFileSync(archiveContentPath, 'utf8')
const adminArtistCardPath = join(root, 'src/app/[locale]/admin/artists/components/ArtistCard.tsx')
const adminArtistCardSource = readFileSync(adminArtistCardPath, 'utf8')
const adminAssignArtistModalPath = join(
  root,
  'src/app/[locale]/admin/artists/components/AssignArtistModal.tsx'
)
const adminAssignArtistModalSource = readFileSync(adminAssignArtistModalPath, 'utf8')
const postContentRendererPath = join(root, 'src/components/PostContentRenderer.tsx')
const postContentRendererSource = readFileSync(postContentRendererPath, 'utf8')
const artistProfilePagePath = join(root, 'src/app/[locale]/artists/[slug]/page.tsx')
const artistProfilePageSource = readFileSync(artistProfilePagePath, 'utf8')
const artistsContentPath = join(root, 'src/app/[locale]/artists/ArtistsContent.tsx')
const artistsContentSource = readFileSync(artistsContentPath, 'utf8')
const portfolioLinksPath = join(
  root,
  'src/app/[locale]/mypage/artist/components/PortfolioLinks.tsx'
)
const portfolioLinksSource = readFileSync(portfolioLinksPath, 'utf8')
const youtubeVideosPath = join(root, 'src/app/[locale]/mypage/artist/components/YoutubeVideos.tsx')
const youtubeVideosSource = readFileSync(youtubeVideosPath, 'utf8')
const projectDetailPath = join(root, 'src/app/[locale]/archive/[slug]/ProjectDetailContent.tsx')
const projectDetailSource = readFileSync(projectDetailPath, 'utf8')
const projectDetailPagePath = join(root, 'src/app/[locale]/archive/[slug]/page.tsx')
const projectDetailPageSource = readFileSync(projectDetailPagePath, 'utf8')
const adminLayoutPath = join(root, 'src/app/[locale]/admin/components/AdminLayout.tsx')
const adminLayoutSource = readFileSync(adminLayoutPath, 'utf8')
const adminDashboardPath = join(root, 'src/app/[locale]/admin/page.tsx')
const adminDashboardSource = readFileSync(adminDashboardPath, 'utf8')
const boardEditPagePath = join(root, 'src/app/[locale]/board/[id]/edit/page.tsx')
const boardEditPageSource = readFileSync(boardEditPagePath, 'utf8')
const validatesBoardRouteIdsBeforeDataAccess =
  /function normalizePostRouteId/.test(boardDetailPageSource) &&
  /validateUUID\(id,\s*['"]게시글 ID['"]\)/.test(boardDetailPageSource) &&
  /const postId = normalizePostRouteId\(resolvedParams\.id\)/.test(boardDetailPageSource) &&
  /if \(!postId\) \{\s*notFound\(\)/.test(boardDetailPageSource) &&
  /const postIdValidation = validateUUID\(id,\s*['"]게시글 ID['"]\)/.test(boardEditPageSource) &&
  /if \(!postIdValidation\.isValid\) \{\s*notFound\(\)/.test(boardEditPageSource) &&
  /const postId = postIdValidation\.sanitized/.test(boardEditPageSource) &&
  !/query: \{ redirect: `\/board\/\$\{id\}\/edit` \}/.test(boardEditPageSource)
const boardWritePagePath = join(root, 'src/app/[locale]/board/write/page.tsx')
const boardWritePageSource = readFileSync(boardWritePagePath, 'utf8')
const activityPagePath = join(root, 'src/app/[locale]/mypage/activity/page.tsx')
const activityPageSource = readFileSync(activityPagePath, 'utf8')
const registerPendingPagePath = join(root, 'src/app/[locale]/register/pending/page.tsx')
const registerPendingPageSource = readFileSync(registerPendingPagePath, 'utf8')
const errorBoundaryPath = join(root, 'src/components/ErrorBoundary.tsx')
const errorBoundarySource = readFileSync(errorBoundaryPath, 'utf8')
const errorTrackingPath = join(root, 'src/utils/errorTracking.ts')
const errorTrackingSource = readFileSync(errorTrackingPath, 'utf8')
const clientErrorApiPath = join(root, 'src/app/api/client-error/route.ts')
const clientErrorApiSource = readFileSync(clientErrorApiPath, 'utf8')
const routeProtectionPath = join(root, 'src/utils/routeProtection.ts')
const routeProtectionSource = readFileSync(routeProtectionPath, 'utf8')
const loadingStatePath = join(root, 'src/hooks/useLoadingState.ts')
const loadingStateSource = readFileSync(loadingStatePath, 'utf8')
const commentLikeButtonPath = join(root, 'src/components/CommentLikeButton.tsx')
const commentLikeButtonSource = readFileSync(commentLikeButtonPath, 'utf8')
const profilePhotoUploaderPath = join(root, 'src/components/ProfilePhotoUploader.tsx')
const profilePhotoUploaderSource = readFileSync(profilePhotoUploaderPath, 'utf8')
const notificationNavigationPath = join(root, 'src/utils/notificationNavigation.ts')
const notificationNavigationSource = readFileSync(notificationNavigationPath, 'utf8')
const notificationDropdownPath = join(root, 'src/components/NotificationDropdown.tsx')
const notificationDropdownSource = readFileSync(notificationDropdownPath, 'utf8')
const notificationsPagePath = join(root, 'src/app/[locale]/notifications/page.tsx')
const notificationsPageSource = readFileSync(notificationsPagePath, 'utf8')
const adminReportsPagePath = join(root, 'src/app/[locale]/admin/reports/page.tsx')
const adminReportsPageSource = readFileSync(adminReportsPagePath, 'utf8')
const eventApplicationsPagePath = join(root, 'src/app/[locale]/admin/event-applications/page.tsx')
const eventApplicationsPageSource = readFileSync(eventApplicationsPagePath, 'utf8')
const boardDocumentListPath = join(root, 'src/app/[locale]/board-room/_components/DocumentList.tsx')
const boardDocumentListSource = readFileSync(boardDocumentListPath, 'utf8')
const footerPath = join(root, 'src/components/Footer.tsx')
const footerSource = readFileSync(footerPath, 'utf8')
const connectPagePath = join(root, 'src/app/[locale]/connect/page.tsx')
const connectPageSource = readFileSync(connectPagePath, 'utf8')
const eventApplicationFormPath = join(root, 'src/components/EventApplicationForm.tsx')
const eventApplicationFormSource = readFileSync(eventApplicationFormPath, 'utf8')
const boardRoomMeetingsPagePath = join(root, 'src/app/[locale]/board-room/meetings/page.tsx')
const boardRoomMeetingsPageSource = readFileSync(boardRoomMeetingsPagePath, 'utf8')
const localizedNavigationFiles = [
  ...globSync('src/app/[[]locale[]]/**/*.tsx', {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  }),
  ...globSync('src/components/**/*.tsx', {
    cwd: root,
    exclude: ['**/node_modules/**', '**/.next/**'],
  }),
]
const nonLocalizedNextLinkImports = localizedNavigationFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /from\s+['"]next\/link['"]/.test(source)
})
const nonLocalizedUseRouterImports = localizedNavigationFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return (
    /from\s+['"]next\/navigation['"]/.test(source) &&
    /import\s+\{[^}]*\buseRouter\b[^}]*\}\s+from\s+['"]next\/navigation['"]/.test(source)
  )
})
const preservesLocaleForInternalNavigation =
  nonLocalizedNextLinkImports.length === 0 &&
  nonLocalizedUseRouterImports.length === 0 &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(adminLayoutSource) &&
  /usePathname/.test(adminLayoutSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(adminDashboardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(articleCardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(artistProjectsSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(baseCardSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(boardEditPageSource) &&
  /locale:\s*locale|\blocale,/.test(boardEditPageSource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(boardWritePageSource) &&
  /locale:\s*locale|\blocale,/.test(boardWritePageSource) &&
  /useLocale/.test(activityPageSource) &&
  /routing\.defaultLocale/.test(activityPageSource) &&
  /window\.open\(localizedLink,\s*['_"]_blank['_"],\s*['_"]noopener,noreferrer['_"]\)/.test(
    activityPageSource
  ) &&
  /useRouter/.test(registerPendingPageSource) &&
  /router\.push\(['"]\/board['"]\)/.test(registerPendingPageSource) &&
  /getLocaleAwareHomePath/.test(errorBoundarySource) &&
  !/window\.location\.href\s*=\s*['"]\/['"]/.test(errorBoundarySource) &&
  /from\s+['"]@\/i18n\/navigation['"]/.test(routeProtectionSource) &&
  /useLocale/.test(routeProtectionSource) &&
  /getLocalizedBrowserPath/.test(routeProtectionSource) &&
  /getCurrentBrowserPath\(\)\s*!==\s*expectedBrowserPath/.test(routeProtectionSource) &&
  !/window\.location\.pathname\s*!==\s*path/.test(routeProtectionSource)
const validatesNotificationNavigationTargets =
  /UUID_PATTERN/.test(notificationNavigationSource) &&
  /notification\.related_post_id/.test(notificationNavigationSource) &&
  !/notification\.data\?\.post_id/.test(notificationNavigationSource) &&
  /getNotificationRoute\(notification,\s*\{\s*fallbackToNotifications:\s*true\s*\}\)/.test(
    notificationDropdownSource
  ) &&
  /getNotificationRoute\(notification\)/.test(notificationsPageSource) &&
  !/notification\.data\?\.post_id/.test(notificationDropdownSource) &&
  !/notification\.data\?\.post_id/.test(notificationsPageSource)
const protectsExternalCardsFromUnsafeUrls =
  /isSafeInternalPath/.test(articleCardSource) &&
  /toSafeHttpUrl/.test(articleCardSource) &&
  /safeExternalUrl/.test(articleCardSource) &&
  !/new URL\(article\.url\)/.test(articleCardSource) &&
  /toSafeHttpUrl/.test(ticketingCardSource) &&
  /safeTicketingUrl/.test(ticketingCardSource) &&
  !/new URL\(ticketing\.url\)/.test(ticketingCardSource)
const filtersRelatedArticlesToSafeExternalUrls =
  /toSafeHttpUrl/.test(projectDetailPageSource) &&
  /const\s+safeUrl\s*=\s*toSafeHttpUrl\(article\.url\)/.test(projectDetailPageSource) &&
  /safeUrl\s*\?\s*\{\s*\.\.\.article,\s*url:\s*safeUrl\s*\}\s*:\s*null/.test(
    projectDetailPageSource
  ) &&
  !/article\s*=>\s*!article\.url\.startsWith\(['"]\/archive\/['"]\)/.test(projectDetailPageSource)
const protectsMarkdownUrlsFromUnsafeRendering =
  /toSafeLinkHref/.test(postContentRendererSource) &&
  /createImageProxy/.test(postContentRendererSource) &&
  /isSafeInternalPath/.test(postContentRendererSource) &&
  !/href=\{href\}/.test(postContentRendererSource) &&
  !/src=\{src\}/.test(postContentRendererSource) &&
  /toSafeLinkHref/.test(artistProfilePageSource) &&
  !/href=\{href\}/.test(artistProfilePageSource) &&
  /toSafeLinkHref/.test(projectDetailSource) &&
  !/href=\{href\}/.test(projectDetailSource)
const protectsPublicImageSourcesFromUnsafeUrls =
  /toSafeInternalImagePath/.test(featuredProjectsSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    featuredProjectsSource
  ) &&
  !/src=\{project\.coverImage\}/.test(featuredProjectsSource) &&
  /toSafeInternalImagePath/.test(featuredArtistsSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeInternalImagePath\(artist\.profileImage\)/.test(
    featuredArtistsSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(featuredArtistsSource) &&
  /toSafeInternalImagePath/.test(artistProjectsSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    artistProjectsSource
  ) &&
  !/src=\{project\.coverImage\}/.test(artistProjectsSource) &&
  /toSafeInternalImagePath/.test(baseCardSource) &&
  /const\s+safeImageSrc\s*=\s*toSafeInternalImagePath\(image\.src\)/.test(baseCardSource) &&
  !/src=\{image\.src\}/.test(baseCardSource) &&
  /toSafeInternalImagePath/.test(artistsContentSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeInternalImagePath\(artist\.profileImage\)/.test(
    artistsContentSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(artistsContentSource) &&
  /toSafeInternalImagePath/.test(artistProfilePageSource) &&
  /safeProfileImage/.test(artistProfilePageSource) &&
  !/src=\{artist\.profileImage\}/.test(artistProfilePageSource) &&
  /toSafeInternalImagePath/.test(archiveContentSource) &&
  /const\s+safeCoverImage\s*=\s*toSafeInternalImagePath\(project\.coverImage\)/.test(
    archiveContentSource
  ) &&
  !/src=\{project\.coverImage\}/.test(archiveContentSource) &&
  /toSafeInternalImagePath/.test(adminArtistCardSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeInternalImagePath\(artist\.profileImage\)/.test(
    adminArtistCardSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(adminArtistCardSource) &&
  /toSafeInternalImagePath/.test(adminAssignArtistModalSource) &&
  /const\s+safeProfileImage\s*=\s*toSafeInternalImagePath\(artist\.profileImage\)/.test(
    adminAssignArtistModalSource
  ) &&
  !/src=\{artist\.profileImage\}/.test(adminAssignArtistModalSource) &&
  /toSafeInternalImagePath/.test(projectDetailSource) &&
  /safeCoverImage/.test(projectDetailSource) &&
  /safeRelatedCoverImage/.test(projectDetailSource) &&
  /safeGalleryImage/.test(projectDetailSource) &&
  !/src=\{project\.coverImage\}/.test(projectDetailSource) &&
  !/src=\{relatedProject\.coverImage\}/.test(projectDetailSource) &&
  !/src=\{image\}/.test(projectDetailSource) &&
  /toSafeInternalImagePath/.test(lightboxSource) &&
  /const\s+safeImages\s*=\s*images\.map\(image\s*=>\s*toSafeInternalImagePath\(image\)\)/.test(
    lightboxSource
  ) &&
  /safeCurrentIndex/.test(lightboxSource) &&
  /src=\{safeImages\[safeCurrentIndex\]\}/.test(lightboxSource) &&
  !/src=\{images\[currentIndex\]\}/.test(lightboxSource)
const preservesAdminArtistAssignmentApiErrors =
  /let errorMessage = `서버 오류 \(\$\{response\.status\}\)`/.test(adminAssignArtistModalSource) &&
  /errorMessage = errorData\.error/.test(adminAssignArtistModalSource) &&
  /throw new Error\(errorMessage\)/.test(adminAssignArtistModalSource) &&
  !/throw new Error\(errorData\.error \|\| `서버 오류/.test(adminAssignArtistModalSource) &&
  /throw new Error\(['"]서버 응답 형식이 올바르지 않습니다\.['"]\)/.test(
    adminAssignArtistModalSource
  ) &&
  /result\.success !== true/.test(adminAssignArtistModalSource) &&
  !/Treating as success despite parse error/.test(adminAssignArtistModalSource)
const protectsProfileAndOperationalLinksFromUnsafeUrls =
  /toSafeEmailHref/.test(safeUrlSource) &&
  /toSafePhoneHref/.test(safeUrlSource) &&
  /toSafeNaverMapSearchHref/.test(safeUrlSource) &&
  /safePortfolioLinks/.test(artistProfilePageSource) &&
  /artistEmailHref/.test(artistProfilePageSource) &&
  /artistPhoneHref/.test(artistProfilePageSource) &&
  !/href=\{`mailto:\$\{artist\.contact\}`\}/.test(artistProfilePageSource) &&
  !/href=\{`tel:\$\{artist\.contact/.test(artistProfilePageSource) &&
  /youtubeChannelLink/.test(artistProfilePageSource) &&
  !/href=\{link\.url\}/.test(artistProfilePageSource) &&
  /toSafeHttpUrl/.test(portfolioLinksSource) &&
  /href=\{safeUrl\}/.test(portfolioLinksSource) &&
  !/href=\{link\.url\}/.test(portfolioLinksSource) &&
  /toSafeHttpUrl/.test(youtubeVideosSource) &&
  /href=\{safeUrl\}/.test(youtubeVideosSource) &&
  !/href=\{video\.url\}/.test(youtubeVideosSource) &&
  /safeVideoUrl/.test(projectDetailSource) &&
  /safeApplicationFormUrl/.test(projectDetailSource) &&
  !/href=\{project\.videoUrl\}/.test(projectDetailSource) &&
  !/href=\{project\.applicationForm\.url\}/.test(projectDetailSource) &&
  /safePhotoUrl/.test(eventApplicationsPageSource) &&
  !/href=\{app\.photo_url\}/.test(eventApplicationsPageSource) &&
  !/src=\{app\.photo_url\}/.test(eventApplicationsPageSource) &&
  /safeDownloadUrl/.test(boardDocumentListSource) &&
  !/href=\{doc\.download_url\}/.test(boardDocumentListSource) &&
  /safeInstagramUrl/.test(footerSource) &&
  /safeYoutubeUrl/.test(footerSource) &&
  /safeEmailHref/.test(footerSource) &&
  /safePhoneHref/.test(footerSource) &&
  /safeAddressHref/.test(footerSource) &&
  !/href=\{`mailto:\$\{data\.contact\.email\}`\}/.test(footerSource) &&
  !/href=\{`tel:\$\{data\.contact\.phone\}`\}/.test(footerSource) &&
  !/map\.naver\.com\/v5\/search\/\$\{encodeURIComponent\(data\.contact\.address\)\}/.test(
    footerSource
  ) &&
  !/href=\{data\.social\./.test(footerSource) &&
  /safeInstagramUrl/.test(connectPageSource) &&
  /safeYoutubeUrl/.test(connectPageSource) &&
  /safeEmailHref/.test(connectPageSource) &&
  /safePhoneHref/.test(connectPageSource) &&
  /safeAddressHref/.test(connectPageSource) &&
  !/href=\{`mailto:\$\{globalData\.contact\.email\}`\}/.test(connectPageSource) &&
  !/href=\{`tel:\$\{globalData\.contact\.phone\}`\}/.test(connectPageSource) &&
  !/map\.naver\.com\/v5\/search\/\$\{encodeURIComponent\(globalData\.contact\.address\)\}/.test(
    connectPageSource
  ) &&
  !/href=\{globalData\.social\./.test(connectPageSource)
const preservesSafeLoginRedirects =
  /useSearchParams/.test(loginPageSource) &&
  /toSafeInternalRedirectPath/.test(loginPageSource) &&
  /searchParams\.get\(['"]redirect['"]\)/.test(loginPageSource) &&
  /postLoginRedirectPath/.test(loginPageSource) &&
  /navigateWithRetry\(postLoginRedirectPath/.test(loginPageSource)
const avoidsClientOperationalConsoleNoise =
  !/console\.log\(/.test(loginPageSource) &&
  !/\[LOGIN DEBUG\]/.test(loginPageSource) &&
  !/console\.log\(/.test(notificationsPageSource) &&
  !/console\.log\(/.test(adminReportsPageSource) &&
  !/console\.log\(/.test(adminAssignArtistModalSource) &&
  !/console\.log\(/.test(adminSettingsPageSource) &&
  /debugRouteProtection/.test(routeProtectionSource) &&
  /errorRouteProtection/.test(routeProtectionSource) &&
  !/from\s+['"]\.\.\/lib\/supabase\/client['"]/.test(routeProtectionSource) &&
  !/console\.log\(/.test(
    routeProtectionSource
      .replace(/const debugRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const warnRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const errorRouteProtection[\s\S]*?\n\}/, '')
  ) &&
  !/console\.error\(/.test(
    routeProtectionSource
      .replace(/const debugRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const warnRouteProtection[\s\S]*?\n\}/, '')
      .replace(/const errorRouteProtection[\s\S]*?\n\}/, '')
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?Auto-recovery attempt/.test(
    errorBoundarySource
  )
const avoidsSupabaseCjsDevAlias =
  !/['"]@supabase\/supabase-js['"]:\s*require\.resolve\(['"]@supabase\/supabase-js['"]\)/.test(
    nextConfigSource
  )
const middlewareUsesStructuredDebugLogging =
  /createLogger\(['"]middleware['"]\)/.test(rootMiddlewareSource) &&
  /createLogger\(['"]middleware\/auth['"]\)/.test(authMiddlewareSource) &&
  /log\.debug/.test(rootMiddlewareSource) &&
  /log\.debug/.test(authMiddlewareSource) &&
  !/console\.log\(/.test(rootMiddlewareSource) &&
  !/console\.log\(/.test(authMiddlewareSource) &&
  !/\[MIDDLEWARE DEBUG\]/.test(authMiddlewareSource)
const adminReportsGuardsStatsFetchLifecycle =
  /const mountedRef = useRef\(true\)/.test(adminReportsPageSource) &&
  /const statsRequestSeqRef = useRef\(0\)/.test(adminReportsPageSource) &&
  /mountedRef\.current = false/.test(adminReportsPageSource) &&
  /const requestSeq = \+\+statsRequestSeqRef\.current/.test(adminReportsPageSource) &&
  /const shouldApplyStatsResult = \(\) =>\s*mountedRef\.current && requestSeq === statsRequestSeqRef\.current/.test(
    adminReportsPageSource
  ) &&
  /if \(!shouldApplyStatsResult\(\)\) \{\s*return\s*\}/.test(adminReportsPageSource) &&
  /if \(shouldApplyStatsResult\(\)\) \{\s*setStatsLoading\(false\)\s*\}/.test(
    adminReportsPageSource
  )
const avoidsLoadingStateProductionConsoleNoise =
  /const shouldLogLoadingState = options\.enableLogging && process\.env\.NODE_ENV === ['"]development['"]/.test(
    loadingStateSource
  ) && !/if \(options\.enableLogging\) \{\s*console\.(?:log|warn|error)\(/.test(loadingStateSource)
const loadingStateAppliesOperationOptions =
  /startLoading\(mergedOptions\)/.test(loadingStateSource) &&
  /finishLoading\(result,\s*mergedOptions\)/.test(loadingStateSource) &&
  /failLoading\(error as Error,\s*mergedOptions\)/.test(loadingStateSource) &&
  /startLoading\(key,\s*mergedOptions\)/.test(loadingStateSource) &&
  /finishLoading\(key,\s*result,\s*mergedOptions\)/.test(loadingStateSource) &&
  /failLoading\(key,\s*error as Error,\s*mergedOptions\)/.test(loadingStateSource)
const singleLoadingStateClearsPreviousTimeout =
  /const startLoading = useCallback\(\s*\(\s*effectiveOptions:[\s\S]*?if \(timeoutRef\.current\) \{\s*clearTimeout\(timeoutRef\.current\)\s*timeoutRef\.current = null\s*\}[\s\S]*?timeoutRef\.current = setTimeout/.test(
    loadingStateSource
  )
const commentLikeButtonCleansAnimationTimer =
  /useRef<NodeJS\.Timeout \| null>\(null\)/.test(commentLikeButtonSource) &&
  /const animationTimeoutRef/.test(commentLikeButtonSource) &&
  /clearTimeout\(animationTimeoutRef\.current\)/.test(commentLikeButtonSource) &&
  /animationTimeoutRef\.current = null/.test(commentLikeButtonSource) &&
  /useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]*?clearTimeout\(animationTimeoutRef\.current\)/.test(
    commentLikeButtonSource
  ) &&
  !/setTimeout\(\(\) => setIsAnimating\(false\),\s*300\)/.test(commentLikeButtonSource)
const profilePhotoUploaderCleansUploadTimers =
  /const progressIntervalRef = useRef<ReturnType<typeof setInterval> \| null>\(null\)/.test(
    profilePhotoUploaderSource
  ) &&
  /const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(
    profilePhotoUploaderSource
  ) &&
  /const clearUploadTimers = useCallback/.test(profilePhotoUploaderSource) &&
  /clearInterval\(progressIntervalRef\.current\)/.test(profilePhotoUploaderSource) &&
  /clearTimeout\(resetTimeoutRef\.current\)/.test(profilePhotoUploaderSource) &&
  /useEffect\(\(\) => \{\s*return clearUploadTimers\s*\}, \[clearUploadTimers\]\)/.test(
    profilePhotoUploaderSource
  ) &&
  !/const progressInterval = setInterval/.test(profilePhotoUploaderSource) &&
  !/clearInterval\(progressInterval\)/.test(profilePhotoUploaderSource)
const adminSettingsSchedulesStatusClear =
  /const scheduleStatusClear = \(delayMs: number,\s*options: \{ clearError\?: boolean \} = \{\}\) => \{[\s\S]*?clearStatusTimer\(\)[\s\S]*?statusTimerRef\.current = setTimeout/.test(
    adminSettingsPageSource
  )
const adminSettingsStatusTimersPreserveNewErrors =
  /scheduleStatusClear\(3000,\s*\{ clearError: false \}\)/.test(adminSettingsPageSource) &&
  /const \{ clearError = true \} = options/.test(adminSettingsPageSource) &&
  /if \(clearError\) \{\s*setError\(null\)\s*\}/.test(adminSettingsPageSource)
const adminSettingsCleansStatusTimers =
  /const statusTimerRef = useRef<ReturnType<typeof setTimeout> \| null>\(null\)/.test(
    adminSettingsPageSource
  ) &&
  /const clearStatusTimer = \(\) => \{[\s\S]*?clearTimeout\(statusTimerRef\.current\)/.test(
    adminSettingsPageSource
  ) &&
  adminSettingsSchedulesStatusClear &&
  adminSettingsStatusTimersPreserveNewErrors &&
  /useEffect\(\(\) => \{[\s\S]*?return clearStatusTimer[\s\S]*?\}, \[\]\)/.test(
    adminSettingsPageSource
  ) &&
  !/setTimeout\(\(\) => setSuccess\(null\),\s*3000\)/.test(adminSettingsPageSource) &&
  !/setTimeout\(\(\) => \{\s*setSuccess\(null\)\s*setError\(null\)\s*\},\s*5000\)/.test(
    adminSettingsPageSource
  )
const sendsClientErrorReportsToApi =
  /fetch\(['"]\/api\/client-error['"]/.test(errorTrackingSource) &&
  /keepalive:\s*immediate/.test(errorTrackingSource) &&
  /client-error endpoint rejected report/.test(errorTrackingSource) &&
  /Promise\.allSettled\(requests\)/.test(errorTrackingSource) &&
  /fetch\(['"]\/api\/client-error['"]/.test(errorBoundarySource) &&
  /keepalive:\s*true/.test(errorBoundarySource) &&
  /function sanitizeClientErrorUrl/.test(clientErrorApiSource) &&
  /parsed\.origin/.test(clientErrorApiSource) &&
  /parsed\.pathname/.test(clientErrorApiSource) &&
  !/const url = body\.url \? String\(body\.url\)/.test(clientErrorApiSource) &&
  !/console\.log\(['"]Sending errors to external service/.test(errorTrackingSource) &&
  !/fetch\(['"]\/api\/errors['"]/.test(errorTrackingSource) &&
  !/Error logged to service/.test(errorBoundarySource)
const redactsSecurityEventDetails =
  /function sanitizeSecurityEventDetails/.test(securitySource) &&
  /function sanitizeSecurityEventValue/.test(securitySource) &&
  /function sanitizeSecurityUrl/.test(securitySource) &&
  /parsed\.origin/.test(securitySource) &&
  /parsed\.pathname/.test(securitySource) &&
  /maskSecurityEmail/.test(securitySource) &&
  /REDACTED_SECURITY_VALUE/.test(securitySource) &&
  /const sanitizedDetails = sanitizeSecurityEventDetails\(details\)/.test(securitySource) &&
  /\.\.\.sanitizedDetails/.test(securitySource) &&
  !/\.\.\.details,\s*\n\s*timestamp/.test(securitySource) &&
  !/Invalid URL format:['"],\s*url/.test(securitySource)
const avoidsArchivePreviewRawUrlLogs =
  /createLogger\(['"]archive\/project-page['"]\)/.test(projectDetailPageSource) &&
  /function describeExternalUrlForLog/.test(projectDetailPageSource) &&
  /parsed\.origin/.test(projectDetailPageSource) &&
  /parsed\.pathname/.test(projectDetailPageSource) &&
  !/Failed to fetch preview for \$\{article\.url\}/.test(projectDetailPageSource)
const validatesEventApplicationPhotoPreviewUrls =
  /isValidEventApplicationPhotoUrl/.test(eventApplicationFormSource) &&
  /uploadedPhotoUrl/.test(eventApplicationFormSource) &&
  /isValidEventApplicationPhotoUrl\(uploadedPhotoUrl\)/.test(eventApplicationFormSource) &&
  /const\s+safePhotoUrl\s*=\s*isValidEventApplicationPhotoUrl\(photoUrl\)\s*\?\s*photoUrl\s*:\s*['"]['"]/.test(
    eventApplicationFormSource
  ) &&
  /src=\{safePhotoUrl\}/.test(eventApplicationFormSource) &&
  /payload\.photo_url\s*=\s*safePhotoUrl\s*\|\|\s*undefined/.test(eventApplicationFormSource) &&
  !/src=\{photoUrl\}/.test(eventApplicationFormSource) &&
  !/payload\.photo_url\s*=\s*photoUrl\s*\|\|\s*undefined/.test(eventApplicationFormSource)
const parsesImageAllowedQualitiesSafely =
  /parseIntegerParam/.test(optimizedImageSource) &&
  /parseIntegerParam\(value,\s*Number\.NaN,\s*\{\s*min:\s*1,\s*max:\s*100\s*\}\)/.test(
    optimizedImageSource
  ) &&
  !/parseInt\(value\.trim\(\),\s*10\)/.test(optimizedImageSource)
const avoidsOptimizedImageProductionUrlLogs =
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?이미지 로딩 실패:[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?모든 이미지 로딩 실패:[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?Supabase 이미지 재시도[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?로딩 지연 감지[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  /process\.env\.NODE_ENV === ['"]development['"][\s\S]*?최종 타임아웃[\s\S]*?currentSrc/.test(
    optimizedImageSource
  ) &&
  !/console\.warn\(`\[OptimizedImage\] 모든 이미지 로딩 실패: \$\{currentSrc\}`\)/.test(
    optimizedImageSource.replace(
      /if \(process\.env\.NODE_ENV === ['"]development['"]\) \{[\s\S]*?\}/g,
      ''
    )
  ) &&
  !/console\.warn\([\s\S]*?\$\{currentSrc\}[\s\S]*?\)/.test(
    optimizedImageSource.replace(
      /if \(process\.env\.NODE_ENV === ['"]development['"]\) \{[\s\S]*?\}/g,
      ''
    )
  )
const validatesGeneratedImageUrls =
  /toSafeHttpUrl/.test(imageUrlSource) &&
  /toSafeInternalImagePath/.test(imageUrlSource) &&
  /function normalizeImagePath/.test(imageUrlSource) &&
  /\^https\?:\\\/\\\//.test(imageUrlSource) &&
  /toSafeHttpUrl\(trimmed\)/.test(imageUrlSource) &&
  /toSafeInternalImagePath\(normalized,\s*['"]['"]\)/.test(imageUrlSource) &&
  /normalizeImagePath\(imagePath\) !== null/.test(imageUrlSource) &&
  !/finalPath\.startsWith\(['"]http['"]\)/.test(imageUrlSource) &&
  !/imagePath\.startsWith\(['"]http['"]\)/.test(imageUrlSource) &&
  /toSafeHttpUrl\(link\.url\)/.test(structuredDataSource) &&
  /toSafeHttpUrl\(ticket\.url\) \?\? eventUrl/.test(structuredDataSource) &&
  !/url && url\.startsWith\(['"]http['"]\)/.test(structuredDataSource) &&
  !/url:\s*ticket\.url/.test(structuredDataSource) &&
  /toSecureMetadataImageUrl/.test(projectDetailPageSource) &&
  /secureOgImageUrl/.test(projectDetailPageSource) &&
  !/secureUrl:\s*ogImageUrl\.startsWith\(['"]https:\/\/['"]\)\s*\?\s*ogImageUrl\s*:\s*`\$\{base\}\$\{ogImageUrl\}`/.test(
    projectDetailPageSource
  )
const serializesJsonLdSafely =
  /export function serializeJsonLd/.test(structuredDataSource) &&
  /replace\(\s*\/<\/g,\s*['"]\\\\u003c['"]\s*\)/.test(structuredDataSource) &&
  /replace\(\s*\/>\/g,\s*['"]\\\\u003e['"]\s*\)/.test(structuredDataSource) &&
  /replace\(\s*\/&\/g,\s*['"]\\\\u0026['"]\s*\)/.test(structuredDataSource) &&
  /__html:\s*serializeJsonLd\(data\)/.test(structuredDataSource) &&
  /serializeJsonLd\(jsonLd\)/.test(connectPageSource) &&
  !/__html:\s*JSON\.stringify/.test(structuredDataSource) &&
  !/__html:\s*JSON\.stringify/.test(connectPageSource)
const sortsBoardRoomMeetingYearsSafely =
  /UNKNOWN_YEAR/.test(boardRoomMeetingsPageSource) &&
  /getMeetingYearKey/.test(boardRoomMeetingsPageSource) &&
  /Number\.isInteger\(year\)/.test(boardRoomMeetingsPageSource) &&
  /날짜 미상/.test(boardRoomMeetingsPageSource) &&
  !/Number\(b\)\s*-\s*Number\(a\)/.test(boardRoomMeetingsPageSource)
const mediaUploadPath = join(root, 'src/app/api/media/upload/route.ts')
const mediaUploadSource = readFileSync(mediaUploadPath, 'utf8')
const cleanupTempAttachmentsPath = join(root, 'src/app/api/cleanup/temp-attachments/route.ts')
const cleanupTempAttachmentsSource = readFileSync(cleanupTempAttachmentsPath, 'utf8')
const avoidsServerOperationalConsoleLogs =
  /createLogger\(['"]api\/security\/csp-report['"]\)/.test(cspReportSource) &&
  /log\.debug\(['"]Ignored CSP report['"]/.test(cspReportSource) &&
  !/console\.log\(/.test(cspReportSource) &&
  /createLogger\(['"]api\/auth\/verify-session['"]\)/.test(authVerifySessionSource) &&
  !/console\.log\(/.test(authVerifySessionSource) &&
  /createLogger\(['"]api\/og\/post['"]\)/.test(postOgImageSource) &&
  /maskId/.test(postOgImageSource) &&
  !/console\.log\(/.test(postOgImageSource) &&
  !/Unsafe attachment image URL, using default OG image['"],\s*imageUrl/.test(postOgImageSource) &&
  /createLogger\(['"]api\/posts\/view['"]\)/.test(postViewSource) &&
  /maskId/.test(postViewSource) &&
  !/console\.log\(/.test(postViewSource) &&
  /createLogger\(['"]api\/mypage\/artist['"]\)/.test(artistProfileSource) &&
  !/console\.log\(/.test(artistProfileSource) &&
  /createLogger\(['"]api\/cleanup\/temp-attachments['"]\)/.test(cleanupTempAttachmentsSource) &&
  !/console\.log\(/.test(cleanupTempAttachmentsSource) &&
  /createLogger\(['"]apiPerformanceMonitor['"]\)/.test(apiPerformanceMonitorSource) &&
  !/console\.log\(/.test(apiPerformanceMonitorSource)
const restrictsMediaUploadBuckets =
  /type\s+AllowedBucket\s*=/.test(mediaUploadSource) &&
  /function\s+isAllowedBucket/.test(mediaUploadSource) &&
  /bucket:\s*AllowedBucket/.test(mediaUploadSource) &&
  /지원하지 않는 Storage bucket입니다/.test(mediaUploadSource)
const sanitizesUploadMetadata =
  /RESERVED_METADATA_KEYS/.test(mediaUploadSource) &&
  /parseMetadataObject/.test(mediaUploadSource) &&
  /sanitizeUserMetadata/.test(mediaUploadSource) &&
  /RESERVED_METADATA_KEYS\.has\(key\)/.test(mediaUploadSource) &&
  /sanitizeUserMetadata\(parseMetadataObject\(metadataValue\)\)/.test(mediaUploadSource) &&
  !/userMetadata\s*=\s*JSON\.parse\(metadataStr\)/.test(mediaUploadSource) &&
  /parseCropSettings/.test(artistPhotoSource) &&
  /getImageDimensions/.test(artistPhotoSource) &&
  /const\s+imageDimensions\s*=\s*await\s+getImageDimensions\(fileBuffer\)/.test(
    artistPhotoSource
  ) &&
  /width:\s*imageDimensions\.width/.test(artistPhotoSource) &&
  /height:\s*imageDimensions\.height/.test(artistPhotoSource) &&
  !/providedMetadata\s*=\s*JSON\.parse/.test(artistPhotoSource) &&
  !/\.\.\.providedMetadata/.test(artistPhotoSource)
const cleanupSkipsUnsafeTempAttachmentUrls =
  /getProjectStorageObjectPath/.test(cleanupTempAttachmentsSource) &&
  /getProjectStorageObjectPath\(att\.file_url,\s*['"]attachments['"],\s*['"]temp['"]\)/.test(
    cleanupTempAttachmentsSource
  ) &&
  /filter\(\(path\):\s*path is string => path !== null\)/.test(cleanupTempAttachmentsSource) &&
  !/const\s+url\s*=\s*new URL\(att\.file_url\)/.test(cleanupTempAttachmentsSource)
const unsafeSearchParamIntegerParsers = appFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return (
    /parseInt\s*\([^)]*searchParams/.test(source) ||
    /Number\.parseInt\s*\([^)]*searchParams/.test(source)
  )
})
const jsonBodyEmptyObjectFallbacks = appFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /request\.json\(\)\.catch\(\s*\(\)\s*=>\s*\(\{\}\)\s*\)/.test(source)
})
const adminMutationJsonBypasses = globSync('src/app/api/admin/**/route.ts', {
  cwd: root,
  exclude: ['**/node_modules/**', '**/.next/**'],
}).filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /request\.json\(\)/.test(source) && !/parseJsonObjectBody/.test(source)
})
const unsafeBlankWindowOpeners = appFiles.filter(file => {
  const source = readFileSync(join(root, file), 'utf8')
  return /window\.open\([^)]*,\s*['"]_blank['"]\s*\)/.test(source)
})

const failures = []

if (edgeRuntimeFiles.length > 0) {
  failures.push(
    `Edge runtime declarations remain:\n${edgeRuntimeFiles.map(file => `- ${file}`).join('\n')}`
  )
}

if (logsAtConstruction) {
  failures.push(
    `distributedRateLimiter logs fallback risk during module construction: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!parsesRedisRateLimitStatsSafely) {
  failures.push(
    `Redis rate-limit stats must parse whole integer counter strings only instead of accepting partial parseInt values: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!supportsVercelMarketplaceUpstashEnv) {
  failures.push(
    `Distributed rate limiting and production env verification must accept Vercel Marketplace Upstash Redis env names (KV_REST_API_URL/TOKEN) as well as legacy UPSTASH_REDIS_REST_URL/TOKEN:\n- ${relative(
      root,
      rateLimiterPath
    )}\n- ${relative(root, verifyEnvPath)}`
  )
}

if (!productionRateLimiterFailsClosed) {
  failures.push(
    `Production rate limiting must fail closed when Upstash is missing or Redis fails instead of silently using per-instance memory fallback: ${relative(
      root,
      rateLimiterPath
    )}`
  )
}

if (!productionRateLimiterDocsFailClosed) {
  failures.push(
    `Rate limiter wrappers and production docs must describe the same fail-closed behavior as the runtime implementation:\n- ${relative(
      root,
      rateLimiterCompatPath
    )}\n- ${relative(root, rateLimitWrapperPath)}\n- ${relative(root, rateLimiterPath)}\n- ${relative(
      root,
      readmePath
    )}\n- ${relative(root, deploymentGuidePath)}`
  )
}

if (!hasSharedServerRateLimitFacade) {
  failures.push(
    `API route rate limiting must go through the shared server facade so route code depends on one operational boundary: ${relative(
      root,
      serverRateLimitPath
    )}`
  )
}

if (!legacyRateLimitWrappersDelegateToServerFacade) {
  failures.push(
    `Legacy rate-limit wrapper modules must delegate to @/lib/server/rateLimit instead of duplicating route-facing logic:\n- ${relative(
      root,
      rateLimiterCompatPath
    )}\n- ${relative(root, rateLimitWrapperPath)}`
  )
}

if (apiRoutesUsingLegacyRateLimitImports.length > 0) {
  failures.push(
    `API routes must import rate-limit helpers from @/lib/server/rateLimit instead of legacy utils modules:\n${apiRoutesUsingLegacyRateLimitImports
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (apiRoutesUsingDistributedRateLimitSymbols.length > 0) {
  failures.push(
    `API routes must use the public rate-limit facade names instead of distributed implementation symbols:\n${apiRoutesUsingDistributedRateLimitSymbols
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (!hasSharedJsonApiRouteWrapper) {
  failures.push(
    `Ordinary JSON API routes need a shared server route assembly helper that preserves route-owned response shapes while centralizing rate-limit, auth, body parsing, and error handling: ${relative(
      root,
      serverApiRoutePath
    )}`
  )
}

if (!adminActivitiesUsersUsesSharedApiRoute) {
  failures.push(
    `The admin activities users JSON route should exercise the shared API route assembly boundary instead of hand-wiring rate limit and admin auth: ${relative(
      root,
      adminActivitiesUsersPath
    )}`
  )
}

if (!adminAnalyticsRoutesUseSharedApiRoute) {
  failures.push(
    `Admin analytics JSON routes should use the shared API route assembly boundary instead of hand-wiring rate limit and admin auth:\n- ${relative(
      root,
      adminAnalyticsPatternsPath
    )}\n- ${relative(root, adminAnalyticsTrendsPath)}`
  )
}

if (!adminStatsRoutesUseSharedApiRoute) {
  failures.push(
    `Admin stats JSON routes should use the shared API route assembly boundary while preserving their per-route user rate-limit keys and headers:\n${adminStatsRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}`
  )
}

if (!adminListingRoutesUseSharedApiRoute) {
  failures.push(
    `Admin listing JSON routes should use the shared API route assembly boundary while preserving their per-route user rate-limit keys and headers:\n${adminListingRouteSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}`
  )
}

if (!adminStandaloneRoutesUseSharedApiRoute) {
  failures.push(
    `Admin performance, real-time activity, and report-generation routes should use the shared API route assembly boundary while preserving route-specific rate-limit/header/body behavior:\n- ${relative(
      root,
      adminPerformancePath
    )}\n- ${relative(root, adminActivitiesRealTimePath)}\n- ${relative(
      root,
      adminReportsGeneratePath
    )}`
  )
}

if (!adminEventApplicationsUsesSharedApiRoute) {
  failures.push(
    `Admin event application CRUD routes should use the shared API route assembly boundary for repeated admin auth and JSON body parsing while preserving existing ApiError/ApiSuccess payloads: ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!adminMemberMutationRoutesUseSharedApiRoute) {
  failures.push(
    `Admin member action and flag mutation routes should use the shared API route assembly boundary while preserving per-route rate-limit keys, body validation, and audit logging:\n- ${relative(
      root,
      adminMemberActionApiPath
    )}\n- ${relative(root, adminMemberFlagsApiPath)}`
  )
}

if (!adminArtistMemberMutationRoutesUseSharedApiRoute) {
  failures.push(
    `Admin artist member assignment routes should use the shared API route assembly boundary for admin auth, params, body parsing, and per-route rate-limit headers:\n- ${relative(
      root,
      adminArtistMembersApiPath
    )}\n- ${relative(root, adminArtistMemberApiPath)}`
  )
}

if (!preventsLinkPreviewPreflightRedirects) {
  failures.push(
    `Link preview preflight must not follow redirects before SSRF checks: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!linkPreviewUsesSharedSsrfProtection) {
  failures.push(
    `Link preview must use the shared SSRF host protection helper instead of a duplicate DNS/IP implementation: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!parsesLinkPreviewContentLengthSafely) {
  failures.push(
    `Link preview content-length checks must parse whole integer strings only instead of accepting partial parseInt values: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!avoidsLinkPreviewOperationalConsoleLogs) {
  failures.push(
    `Link preview normal fetch/extraction traces must use development-only logger.debug instead of unconditional console.log metadata dumps: ${relative(
      root,
      linkPreviewPath
    )}`
  )
}

if (!ssrfProtectionHandlesLiteralIpsStrictly) {
  failures.push(
    `Shared SSRF host protection must normalize literal IPv6 hosts and reject private/reserved literal IP ranges before DNS lookup: ${relative(
      root,
      ssrfProtectionPath
    )}`
  )
}

if (!validateUUIDRejectsTempIds) {
  failures.push(
    `validateUUID must reject temp-* IDs so DB UUID route/body checks cannot pass non-UUID values: ${relative(
      root,
      validationPath
    )}`
  )
}

if (middlewareSupabaseImports.length > 0) {
  failures.push(
    `Middleware imports Supabase packages directly:\n${middlewareSupabaseImports
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (!middlewarePreservesProtectedLoginRedirects) {
  failures.push(
    `Middleware auth redirects must preserve protected internal paths and handle locale-prefixed paths before sending users to login: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!middlewareProtectsOnlyValidBoardEditIds) {
  failures.push(
    `Middleware must only treat /board/:id/edit as a protected edit route when :id is a UUID, so malformed post IDs fall through to page-level 404 instead of login redirects: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!middlewareRedirectsApprovedRegistrationPagesToBoard) {
  failures.push(
    `Middleware registration-page redirects must send approved active users to /board instead of deriving a non-existent /register/approved path: ${relative(
      root,
      authMiddlewarePath
    )}`
  )
}

if (!postCreationUsesServerApi || !boardPostCreationAvoidsRefreshQuery) {
  failures.push(
    `Board post creation must go through the server API and return to a clean board URL without a refresh cachebuster:\n- ${relative(
      root,
      usePostCreationPath
    )}\n- ${relative(root, writePageClientPath)}`
  )
}

if (!postsApiCreatesPostsWithServerAuthAndInvalidatesBoard) {
  failures.push(
    `POST /api/posts must authenticate on the server, enforce approved active member status, create posts with server-derived author_id, and invalidate board caches: ${relative(
      root,
      postsApiPath
    )}`
  )
}

if (!postEditUsesServerApi || !postsApiUpdatesPostsWithServerAuthAndInvalidatesBoard) {
  failures.push(
    `Board post editing must go through PATCH /api/posts/:id with server-side membership/ownership checks and board cache invalidation:\n- ${relative(
      root,
      editPageClientPath
    )}\n- ${relative(root, postDetailApiPath)}`
  )
}

if (!profilePageUsesServerApi || !profileApiRestrictsSelfUpdates) {
  failures.push(
    `My page profile edits must go through /api/mypage/profile with server-side approved-member checks and a narrow self-update allowlist:\n- ${relative(
      root,
      mypageProfilePagePath
    )}\n- ${relative(root, mypageProfileApiPath)}`
  )
}

if (!commentLikesAvoidBearerTokenForwarding) {
  failures.push(
    `Comment likes must rely on the server cookie session API and must not forward browser access tokens in Authorization headers: ${relative(
      root,
      useCommentLikesPath
    )}`
  )
}

if (!likeHooksUseServerSessionTruth) {
  failures.push(
    `Post/comment like hooks must use /api/auth/verify-session as the client session truth and avoid direct browser Supabase auth reads:\n- ${relative(
      root,
      usePostLikesPath
    )}\n- ${relative(root, useCommentLikesPath)}`
  )
}

if (!activityLoggerAvoidsBearerTokenForwarding) {
  failures.push(
    `Activity logging must rely on the server cookie session API and must not store or forward browser access tokens in Authorization headers: ${relative(
      root,
      activityLoggerEarlyPath
    )}`
  )
}

if (!mypagePermissionUsesServerSessionTruth) {
  failures.push(
    `My page permission/navigation checks must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n- ${relative(
      root,
      authVerifySessionPath
    )}\n- ${relative(root, mypagePermissionCheckPath)}\n- ${relative(root, mypageNavigationPath)}`
  )
}

if (!boardUserSectionUsesServerSessionTruth) {
  failures.push(
    `Board user actions must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n- ${relative(
      root,
      boardUserSectionPath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!navigationUsesServerSessionTruth) {
  failures.push(
    `Global navigation auth/menu state must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles/getSession reads:\n- ${relative(
      root,
      navigationPath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!verifySessionTreatsMissingSessionAsNormal) {
  failures.push(
    `Verify-session must treat missing auth sessions as a normal unauthenticated state instead of emitting server error logs: ${relative(
      root,
      authVerifySessionPath
    )}`
  )
}

if (!authClientPagesUseServerSessionTruth) {
  failures.push(
    `Auth-facing client pages must rely on server session/profile truth instead of browser member_profiles/getSession reads:\n- ${relative(
      root,
      loginPagePath
    )}\n- ${relative(root, authRegisterPendingPagePath)}\n- ${relative(
      root,
      authMypageArtistPagePath
    )}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!resetPasswordUsesServerSessionTruth) {
  failures.push(
    `Reset-password must validate the recovery cookie session and update the password through server APIs instead of browser Supabase getSession/updateUser state:\n- ${relative(
      root,
      resetPasswordPagePath
    )}\n- ${relative(root, authResetPasswordApiPath)}`
  )
}

if (!boardRoomClientPagesUseServerSessionTruth) {
  failures.push(
    `Board-room client admin checks must use /api/auth/verify-session as the server truth and avoid direct browser member_profiles reads:\n${boardRoomClientPageSources
      .map(({ path }) => `- ${relative(root, path)}`)
      .join('\n')}\n- ${relative(root, authVerifySessionPath)}`
  )
}

if (!hasSharedOperationalBoundaryHelpers) {
  failures.push(
    `Server operational boundaries must expose shared env, service-role Supabase, and authz helpers before more route refactors:\n- ${relative(
      root,
      serverEnvPath
    )}\n- ${relative(root, supabaseAdminPath)}\n- ${relative(root, authzPath)}`
  )
}

if (directServiceRoleClientCreationFiles.length > 0) {
  failures.push(
    `Service-role Supabase clients must be created through src/lib/server/supabaseAdmin.ts instead of route/local createClient calls:\n${directServiceRoleClientCreationFiles
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (!existingAuthHelpersUseSharedOperationalBoundaries) {
  failures.push(
    `Existing admin and board-room auth helpers must consume shared service-role and authz boundaries instead of duplicating profile/client setup:\n- ${relative(
      root,
      adminAuthPathForBoundary
    )}\n- ${relative(root, boardRoomAuthPathForBoundary)}`
  )
}

if (!authCallbackParsesMonthlyFeeSafely) {
  failures.push(
    `Auth callback profile creation must sanitize monthly_fee metadata so NaN cannot be inserted: ${relative(
      root,
      authCallbackPath
    )}`
  )
}

if (!authCallbackPreservesEmailFlowLocale) {
  failures.push(
    `Auth email callbacks must carry and validate the active locale so signup and password-reset links return users to the matching localized flow:\n- ${relative(
      root,
      authCallbackPath
    )}\n- ${relative(root, signupPagePath)}\n- ${relative(root, forgotPasswordPagePath)}`
  )
}

if (!verifiesAttachmentSignature) {
  failures.push(
    `Post attachment uploads must verify file signatures before Storage upload: ${relative(
      root,
      postAttachmentsPath
    )}`
  )
}

if (!preservesTemporaryPostAttachmentUploads) {
  failures.push(
    `Temporary post attachment uploads must use an explicit UUID-or-temp-id validator instead of the strict DB UUID validator: ${relative(
      root,
      postAttachmentsPath
    )}`
  )
}

if (!verifiesBoardDocumentSignature) {
  failures.push(
    `Board document uploads must verify file signatures before Storage upload: ${relative(
      root,
      boardDocumentsPath
    )}`
  )
}

if (!validatesBoardDocumentStoragePaths) {
  failures.push(
    `Board document signed URLs and deletes must validate DB file_path values against the uploader-owned Storage object path shape:\n- ${relative(
      root,
      boardDocumentsPath
    )}\n- ${relative(root, boardDocumentDetailPath)}\n- ${relative(root, boardDocumentStoragePathPath)}`
  )
}

if (!verifiesArtistPhotoSignature) {
  failures.push(
    `Artist photo uploads must verify image signatures before processing: ${relative(
      root,
      artistPhotoPath
    )}`
  )
}

if (!validatesArtistPhotoCleanupStoragePaths) {
  failures.push(
    `Artist photo cleanup must validate metadata variant paths and legacy Storage URLs under the artist prefix before remove: ${relative(
      root,
      artistPhotoPath
    )}`
  )
}

if (!validatesArtistProfilePhotoStorageUrl) {
  failures.push(
    `Artist profile updates must preserve uploaded photo variant metadata but reject photo URLs or variant paths outside the project Storage artist prefix: ${relative(
      root,
      artistProfilePath
    )}`
  )
}

if (!preventsArtistProfileServerGitSideEffects) {
  failures.push(
    `Artist profile PATCH must not write fallback JSON or run git commands from the web request path; Supabase plus cache revalidation is the live source of truth:\n- ${relative(
      root,
      artistProfilePath
    )}\n- ${relative(root, jsonSyncPath)}`
  )
}

if (!validatesPostOgAttachmentStorageUrl) {
  failures.push(
    `Post OG image redirects must only use project Storage attachment URLs and fall back for unsafe attachment rows: ${relative(
      root,
      postOgImagePath
    )}`
  )
}

if (!validatesStaticOgImageRedirects) {
  failures.push(
    `Artist/project OG image redirects must only use safe internal image paths from local JSON data:\n- ${relative(
      root,
      artistOgImagePath
    )}\n- ${relative(root, projectOgImagePath)}\n- ${relative(root, legacyOgImagePath)}`
  )
}

if (!validatesImagesApiPublicPathBoundary) {
  failures.push(
    `Images API must use path.relative containment and supported image MIME allow-listing before reading files: ${relative(
      root,
      imagesApiPath
    )}`
  )
}

if (!scopesCommentDeleteToPost) {
  failures.push(
    `Comment deletion must scope both ownership lookup and delete query to the route post id: ${relative(
      root,
      commentDeletePath
    )}`
  )
}

if (!validatesAttachmentMetadataUpdate) {
  failures.push(
    `Post attachment metadata updates/deletes must validate field types and scope writes to the route post id: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesAttachmentDeleteAdminStatus) {
  failures.push(
    `Post attachment delete admin override must require approved active admin status: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesAttachmentDeleteStoragePath) {
  failures.push(
    `Post attachment delete must derive Storage remove paths from validated project Storage URLs under the route post prefix: ${relative(
      root,
      postAttachmentDetailPath
    )}`
  )
}

if (!validatesPostAttachmentRenderUrls) {
  failures.push(
    `Post attachment render/download surfaces must only expose project Storage attachment URLs:\n- ${relative(
      root,
      postAttachmentsDisplayPath
    )}\n- ${relative(root, attachmentCardPath)}\n- ${relative(root, imageModalPath)}\n- ${relative(
      root,
      attachmentActionsPath
    )}`
  )
}

if (!validatesAdminPostRouteId) {
  failures.push(
    `Admin post actions must validate the route post id before lookup/update: ${relative(
      root,
      adminPostDetailPath
    )}`
  )
}

if (!validatesNotificationRouteId) {
  failures.push(
    `Notification item actions must validate the route notification id before RPC/delete: ${relative(
      root,
      notificationDetailPath
    )}`
  )
}

if (!validatesNotificationMutationIds) {
  failures.push(
    `Notification APIs must validate notification types/user/post IDs, expiry timestamps, title/message text, and sanitize JSON data before query/RPC calls:\n- ${relative(
      root,
      notificationsPath
    )}\n- ${relative(root, bulkNotificationsPath)}\n- ${relative(
      root,
      notificationDataPath
    )}\n- ${relative(root, notificationExpiryPath)}\n- ${relative(root, notificationTypesPath)}`
  )
}

if (!validatesUserLikesRouteId) {
  failures.push(
    `User likes listing must validate the route user id before RPC/count queries: ${relative(
      root,
      userLikesPath
    )}`
  )
}

if (!validatesUserLikesAdminStatus) {
  failures.push(
    `User likes admin override must require approved active admin status: ${relative(
      root,
      userLikesPath
    )}`
  )
}

if (!validatesPostDetailAdminStatus) {
  failures.push(
    `Post detail deleted-post admin override must require approved active admin status: ${relative(
      root,
      postDetailPath
    )}`
  )
}

if (!validatesBoardRouteIdsBeforeDataAccess) {
  failures.push(
    `Board detail/edit pages must validate route post ids before metadata fetches, DB queries, or login redirect query composition:\n- ${relative(
      root,
      boardDetailPagePath
    )}\n- ${relative(root, boardEditPagePath)}`
  )
}

if (!parsesApiWrapperPaginationSafely) {
  failures.push(
    `API wrapper pagination must fall back from non-numeric page/limit values instead of returning NaN: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!validatesApiWrapperSortFields) {
  failures.push(
    `API wrapper sort parsing must default to a closed allowlist instead of accepting arbitrary orderBy values when callers omit allowedFields: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!avoidsApiWrapperRequireAdminNameCollision) {
  failures.push(
    `apiWrapper must not export a route-auth-looking requireAdmin helper that can be confused with lib/server/adminAuth.requireAdmin; use requireAdminRole for role-string checks: ${relative(
      root,
      apiWrapperPath
    )}`
  )
}

if (!parsesIntegerParamsAsWholeStrings) {
  failures.push(
    `Integer query parameters must only accept whole integer strings before clamping: ${relative(
      root,
      queryParamsPath
    )}`
  )
}

if (!sanitizesDownloadFilenames) {
  failures.push(
    `File download helpers must sanitize Content-Disposition filenames before writing response headers: ${relative(
      root,
      apiResponsePath
    )}`
  )
}

if (!sanitizesCspReportFields) {
  failures.push(
    `CSP report collection must sanitize report field types before string/number operations so malformed browser reports return 400 instead of 500: ${relative(
      root,
      cspReportPath
    )}`
  )
}

if (!postsApiParsesPaginationSafely) {
  failures.push(
    `Posts API pagination must use parseIntegerParam so malformed page/cursor values fall back consistently: ${relative(
      root,
      postsApiPath
    )}`
  )
}

if (!boardPageParsesSearchParamsSafely) {
  failures.push(
    `Board page search params must use parseIntegerParam so malformed page values do not leak into pagination or canonical metadata: ${relative(
      root,
      boardPagePath
    )}`
  )
}

if (!archivePageParsesSearchParamsSafely) {
  failures.push(
    `Archive page search params must use parseIntegerParam so malformed page values do not leak into pagination or canonical metadata: ${relative(
      root,
      archivePagePath
    )}`
  )
}

if (!parsesMemberFeeInputsSafely) {
  failures.push(
    `Member monthly fee inputs must parse whole integer strings only instead of accepting partial parseInt values:\n- ${relative(
      root,
      signupPagePath
    )}\n- ${relative(root, cooperativeInfoPath)}`
  )
}

if (!parsesAdminSettingNumberInputsSafely) {
  failures.push(
    `Admin setting number inputs must parse whole integer strings only instead of accepting partial parseInt values: ${relative(
      root,
      adminSettingsPagePath
    )}`
  )
}

if (!parsesAdminOperationalNumberInputsSafely) {
  failures.push(
    `Admin operational number inputs must parse whole integer strings only instead of accepting partial parseInt/Number values:\n- ${relative(
      root,
      adminNotificationsPagePath
    )}\n- ${relative(root, adminReportGeneratorPath)}\n- ${relative(
      root,
      recentActivityPath
    )}\n- ${relative(root, activityAnalyticsChartsPath)}`
  )
}

if (!avoidsAdminMembersOperationalConsoleNoise) {
  failures.push(
    `Admin members page must not log member IDs, request bodies, or member records to the browser console: ${relative(
      root,
      adminMembersPagePath
    )}`
  )
}

if (!adminMembersRefreshAvoidsUrlCachebuster) {
  failures.push(
    `Admin member list refresh must use fetch cache controls instead of appending timestamp cachebuster query parameters: ${relative(
      root,
      adminMembersPagePath
    )}`
  )
}

if (!validatesAdminReportGenerationInputs) {
  failures.push(
    `Admin report generation must validate report type, date range, and reflected filters before building report metadata or queries: ${relative(
      root,
      adminReportGenerateApiPath
    )}`
  )
}

if (!parsesMypageSettingNumberInputsSafely) {
  failures.push(
    `Mypage setting number inputs must parse whole integer strings only instead of accepting partial parseInt values:\n- ${relative(
      root,
      mypageSecuritySettingsPath
    )}\n- ${relative(root, mypagePreferenceSettingsPath)}\n- ${relative(
      root,
      mypageInterfaceSettingsPath
    )}`
  )
}

if (!parsesPostViewTimestampsSafely) {
  failures.push(
    `Post view duplicate-window timestamps must parse safely so malformed client storage/header values do not suppress view increments:\n- ${relative(
      root,
      postDetailClientPath
    )}\n- ${relative(root, postViewPath)}`
  )
}

if (!parsesImageProxyContentLengthSafely) {
  failures.push(
    `Image proxy content-length checks must parse whole integer strings only instead of accepting Number-coerced remote header values: ${relative(
      root,
      imageProxyPath
    )}`
  )
}

if (!parsesAttachmentSizesSafely) {
  failures.push(
    `Post attachment size totals must parse whole non-negative integer byte strings before adding response stats:\n- ${relative(
      root,
      boardPostDetailPath
    )}\n- ${relative(root, serverBoardPath)}\n- ${relative(root, boardDetailPagePath)}`
  )
}

if (!validatesRenderedArtistProfilePhotoUrls) {
  failures.push(
    `Rendered artist profile photo URLs must be revalidated against project Storage artist prefixes before reaching img src:\n- ${relative(
      root,
      postDetailClientPath
    )}\n- ${relative(root, mypageProfilePersonalInfoPath)}\n- ${relative(
      root,
      mypageProfileEditFormPath
    )}\n- ${relative(root, mypageArtistPagePath)}`
  )
}

if (!profileEditFormGuardsArtistFetchUnmount) {
  failures.push(
    `Profile edit artist data fetch must avoid setting state after the form unmounts: ${relative(
      root,
      mypageProfileEditFormPath
    )}`
  )
}

if (!validatesEventApplicationPhotoPreviewUrls) {
  failures.push(
    `Event application photo upload responses, previews, and submit payloads must revalidate project Storage URLs before trusting photo_url: ${relative(
      root,
      eventApplicationFormPath
    )}`
  )
}

if (!parsesImageAllowedQualitiesSafely) {
  failures.push(
    `OptimizedImage allowed-quality env parsing must reject partial parseInt values and clamp through the shared whole-integer parser: ${relative(
      root,
      optimizedImagePath
    )}`
  )
}

if (!avoidsOptimizedImageProductionUrlLogs) {
  failures.push(
    `OptimizedImage must not emit raw image src values to production console warnings when fallback loading fails: ${relative(
      root,
      optimizedImagePath
    )}`
  )
}

if (!validatesGeneratedImageUrls) {
  failures.push(
    `Generated image and JSON-LD URLs must pass through safe HTTP/internal-image helpers before reaching metadata, sitemaps, or structured data:\n- ${relative(
      root,
      imageUrlPath
    )}\n- ${relative(root, structuredDataPath)}`
  )
}

if (!serializesJsonLdSafely) {
  failures.push(
    `JSON-LD script output must escape script-breaking characters instead of passing raw JSON.stringify into dangerouslySetInnerHTML:\n- ${relative(
      root,
      structuredDataPath
    )}\n- ${relative(root, connectPagePath)}`
  )
}

if (!sortsBoardRoomMeetingYearsSafely) {
  failures.push(
    `Board-room meeting year grouping must avoid NaN year labels and sort malformed dates last: ${relative(
      root,
      boardRoomMeetingsPagePath
    )}`
  )
}

if (!validatesAdvancedFilterFiniteNumbers) {
  failures.push(
    `Advanced search numeric filters must reject non-finite Number conversions before building SQL params: ${relative(
      root,
      advancedFilteringPath
    )}`
  )
}

if (!validatesAdvancedSearchSqlAllowlists) {
  failures.push(
    `Advanced search SQL builders must require explicit field allowlists and bounded pagination before composing SQL: ${relative(
      root,
      advancedFilteringPath
    )}`
  )
}

if (!parsesSessionPingIntervalSafely) {
  failures.push(
    `Activity logger session ping interval must use bounded whole-integer env parsing instead of Number/isNaN fallback logic: ${relative(
      root,
      activityLoggerPath
    )}`
  )
}

if (!authRedirectBlocklistHandlesLocalePrefixes) {
  failures.push(
    `Auth redirect sanitization must block locale-prefixed auth pages like /en/login to avoid post-login loops: ${relative(
      root,
      safeUrlPath
    )}`
  )
}

if (!validatesAdminAnalyticsUserIdFilters) {
  failures.push(
    `Admin analytics user_id filters must validate UUIDs before service-role queries:\n- ${relative(
      root,
      adminActivitiesUsersPath
    )}\n- ${relative(root, adminAnalyticsPatternsPath)}`
  )
}

if (!validatesAdminAnalyticsQueryEnums) {
  failures.push(
    `Admin analytics and performance query modes must use shared runtime allowlists before switch handling or response echoing:\n- ${relative(
      root,
      adminAnalyticsConstantsPath
    )}\n- ${relative(root, adminAnalyticsTrendsPath)}\n- ${relative(root, adminPerformancePath)}`
  )
}

if (!validatesAdminPerformanceExportDates) {
  failures.push(
    `Admin performance metric exports must validate, order-check, bound, and normalize startTime/endTime before filtering metrics: ${relative(
      root,
      adminPerformancePath
    )}`
  )
}

if (!validatesUserSettingsAllowlists) {
  failures.push(
    `User settings APIs must validate category and setting_key against the default settings contract before filtering or RPC writes:\n- ${relative(
      root,
      userSettingsConstantsPath
    )}\n- ${relative(root, userSettingsApiPath)}\n- ${relative(root, userSettingsResetApiPath)}`
  )
}

if (!validatesAdminActivityTypeFilters) {
  failures.push(
    `Admin activity action_type and target_type filters must use shared runtime enum allowlists before service-role queries:\n- ${relative(
      root,
      activityConstantsPath
    )}\n- ${relative(root, adminActivitiesUsersPath)}`
  )
}

if (!validatesActivityLogTypes) {
  failures.push(
    `Activity logging APIs must validate action_type, target_type, and target_id before calling log_user_activity:\n- ${relative(
      root,
      activityLogPath
    )}\n- ${relative(root, activityBatchLogPath)}\n- ${relative(root, activityConstantsPath)}`
  )
}

if (boardRoomDynamicRouteChecks.length > 0) {
  failures.push(
    `Board-room service-role dynamic routes must validate UUID route ids before Supabase queries:\n${boardRoomDynamicRouteChecks
      .map(({ path }) => `- ${path}`)
      .join('\n')}`
  )
}

if (!validatesBoardRoomAttendeesMeetingId) {
  failures.push(
    `Board-room attendees API must validate meeting_id before service-role lookup/upsert: ${relative(
      root,
      boardRoomAttendeesPath
    )}`
  )
}

if (!validatesBoardRoomMinutesContentFormat) {
  failures.push(
    `Board-room minutes APIs must allowlist content_format before storing renderer mode values:\n- ${relative(
      root,
      contentFormatConstantsPath
    )}\n- ${relative(root, boardRoomMinutesPath)}\n- ${relative(root, boardRoomMinutesDetailPath)}`
  )
}

if (!validatesBoardRoomMeetingDateInputs) {
  failures.push(
    `Board-room meeting APIs must validate candidate dates, vote deadlines, confirm dates, and status transitions before storing schedule values:\n- ${relative(
      root,
      boardRoomConstantsPath
    )}\n- ${relative(root, boardRoomMeetingsPath)}\n- ${relative(root, boardRoomMeetingDetailPath)}`
  )
}

if (!validatesBoardRoomAgendaSortOrder) {
  failures.push(
    `Board-room agenda updates must validate sort_order as a bounded integer before storing display order:\n- ${relative(
      root,
      boardRoomConstantsPath
    )}\n- ${relative(root, boardRoomAgendaDetailPath)}`
  )
}

if (boardRoomCreateRouteIdChecks.length > 0) {
  failures.push(
    `Board-room body IDs must be validated before service-role queries or writes:\n${boardRoomCreateRouteIdChecks
      .map(({ path }) => `- ${path}`)
      .join('\n')}`
  )
}

if (!protectsExternalCardsFromUnsafeUrls) {
  failures.push(
    `External article/ticketing cards must sanitize hrefs and avoid render-time URL parsing crashes:\n- ${relative(
      root,
      articleCardPath
    )}\n- ${relative(root, ticketingCardPath)}`
  )
}

if (!filtersRelatedArticlesToSafeExternalUrls) {
  failures.push(
    `Archive project related-article data must normalize to safe external http(s) URLs before ArticleCard receives it: ${relative(
      root,
      projectDetailPagePath
    )}`
  )
}

if (!protectsMarkdownUrlsFromUnsafeRendering) {
  failures.push(
    `Markdown renderers must sanitize link hrefs and proxy external image src values before rendering:\n- ${relative(
      root,
      postContentRendererPath
    )}\n- ${relative(root, artistProfilePagePath)}\n- ${relative(root, projectDetailPath)}`
  )
}

if (!protectsPublicImageSourcesFromUnsafeUrls) {
  failures.push(
    `Public card, artist, and project image sources must use safe internal image paths before reaching OptimizedImage:\n- ${relative(
      root,
      featuredProjectsPath
    )}\n- ${relative(root, featuredArtistsPath)}\n- ${relative(
      root,
      artistProjectsPath
    )}\n- ${relative(root, baseCardPath)}\n- ${relative(root, archiveContentPath)}\n- ${relative(
      root,
      adminArtistCardPath
    )}\n- ${relative(root, adminAssignArtistModalPath)}\n- ${relative(
      root,
      artistsContentPath
    )}\n- ${relative(root, artistProfilePagePath)}\n- ${relative(
      root,
      projectDetailPath
    )}\n- ${relative(root, lightboxPath)}`
  )
}

if (!preservesAdminArtistAssignmentApiErrors) {
  failures.push(
    `Artist assignment UI must preserve JSON API error messages and reject malformed success responses instead of treating them as success: ${relative(
      root,
      adminAssignArtistModalPath
    )}`
  )
}

if (!protectsProfileAndOperationalLinksFromUnsafeUrls) {
  failures.push(
    `Profile, archive, admin, and board-room download links must sanitize href/src URL values before rendering:\n- ${relative(
      root,
      artistProfilePagePath
    )}\n- ${relative(root, portfolioLinksPath)}\n- ${relative(
      root,
      youtubeVideosPath
    )}\n- ${relative(root, projectDetailPath)}\n- ${relative(
      root,
      eventApplicationsPagePath
    )}\n- ${relative(root, boardDocumentListPath)}`
  )
}

if (!validatesEventApplicationStatusAllowlist) {
  failures.push(
    `Event application status filters and mutations must share a runtime allowlist instead of accepting arbitrary strings:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}\n- ${relative(root, eventApplicationStatusPath)}`
  )
}

if (!validatesAdminEventApplicationSlug) {
  failures.push(
    `Admin event application filters must normalize and validate event_slug before querying:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!validatesEventApplicationDeleteId) {
  failures.push(
    `Event application deletion must validate and normalize the id with validateUUID before deleting:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}`
  )
}

if (!validatesBoardCategoryFilters) {
  failures.push(
    `Board category filters must use the shared parseBoardCategory allowlist before Supabase category queries:\n- ${relative(
      root,
      boardCategoriesPath
    )}\n- ${relative(root, serverBoardPath)}\n- ${relative(root, boardCategoryPagePath)}\n- ${relative(
      root,
      boardPostsApiPath
    )}\n- ${relative(root, boardListPostsApiPath)}\n- ${relative(root, publicPostsApiPath)}`
  )
}

if (!validatesPublicPostsCursor) {
  failures.push(
    `Public posts cursor pagination must reject malformed cursor/sort values and keep deterministic created_at/id ordering:\n- ${relative(
      root,
      publicPostsApiPath
    )}`
  )
}

if (!validatesCommentCursors) {
  failures.push(
    `Comment cursor pagination must reject malformed cursors and validate cursor IDs before keyset RPC/query use:\n- ${relative(
      root,
      keysetCursorPath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(root, commentsListApiPath)}`
  )
}

if (!annotatesAuthenticatedCommentLikeState) {
  failures.push(
    `Authenticated board comment lists must annotate each comment with the current user's like state so already-liked comments render correctly on SSR detail and load-more paths:\n- ${relative(
      root,
      boardDetailPagePath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(
      root,
      commentsListApiPath
    )}\n- ${relative(root, commentLikesHelperPath)}`
  )
}

if (!validatesPostRouteIdsUseSanitizedUuid) {
  failures.push(
    `Dynamic/member route IDs must use sanitized values for DB/RPC boundaries after validation:\n- ${relative(
      root,
      adminEventApplicationsApiPath
    )}\n- ${relative(root, adminMemberActionApiPath)}\n- ${relative(
      root,
      adminMemberFlagsApiPath
    )}\n- ${relative(root, adminMembersBulkApiPath)}\n- ${relative(
      root,
      adminArtistMembersApiPath
    )}\n- ${relative(root, adminArtistMemberApiPath)}\n- ${relative(
      root,
      postContentApiPath
    )}\n- ${relative(root, commentsApiPath)}\n- ${relative(
      root,
      commentsListApiPath
    )}\n- ${relative(root, postLikesApiPath)}\n- ${relative(root, postOgImagePath)}\n- ${relative(
      root,
      postUserDataApiPath
    )}\n- ${relative(root, commentLikeApiPath)}`
  )
}

if (!preservesLocaleForInternalNavigation) {
  failures.push(
    `Locale-scoped internal navigation must use '@/i18n/navigation' and preserve the active locale for Link, router, pathname, redirect, and window.open flows. Remaining next/link imports:\n${
      nonLocalizedNextLinkImports.length > 0
        ? nonLocalizedNextLinkImports.map(file => `- ${file}`).join('\n')
        : '- none'
    }\nRemaining next/navigation useRouter imports:\n${
      nonLocalizedUseRouterImports.length > 0
        ? nonLocalizedUseRouterImports.map(file => `- ${file}`).join('\n')
        : '- none'
    }`
  )
}

if (!validatesNotificationNavigationTargets) {
  failures.push(
    `Notification click routing must use validated related_post_id values instead of JSON metadata post_id values when building board routes:\n- ${relative(
      root,
      notificationNavigationPath
    )}\n- ${relative(root, notificationDropdownPath)}\n- ${relative(root, notificationsPagePath)}`
  )
}

if (!preservesSafeLoginRedirects) {
  failures.push(
    `Login must preserve safe internal redirect paths after successful member login instead of always sending users to /board: ${relative(
      root,
      loginPagePath
    )}`
  )
}

if (!loginPageCleansAuthRedirectTimers) {
  failures.push(
    `Login auth checks and delayed redirects must guard unmounts and clear redirect timers before rescheduling: ${relative(
      root,
      loginPagePath
    )}`
  )
}

if (!registerPendingGuardsSessionFetchUnmount) {
  failures.push(
    `Register pending session checks must avoid setting state or showing stale alerts after the page unmounts: ${relative(
      root,
      authRegisterPendingPagePath
    )}`
  )
}

if (!avoidsClientOperationalConsoleNoise) {
  failures.push(
    `Client-facing auth, notification, admin, and recovery UI must not emit operational console.log traces:\n- ${relative(
      root,
      loginPagePath
    )}\n- ${relative(root, notificationsPagePath)}\n- ${relative(
      root,
      adminReportsPagePath
    )}\n- ${relative(root, adminAssignArtistModalPath)}\n- ${relative(
      root,
      adminSettingsPagePath
    )}\n- ${relative(root, routeProtectionPath)}\n- ${relative(root, errorBoundaryPath)}`
  )
}

if (!adminReportsGuardsStatsFetchLifecycle) {
  failures.push(
    `Admin reports stats fetches must avoid stale or unmounted state updates across initial, manual, and auto-refresh loads: ${relative(
      root,
      adminReportsPagePath
    )}`
  )
}

if (!avoidsSupabaseCjsDevAlias) {
  failures.push(
    `Next dev config must not alias @supabase/supabase-js through require.resolve because it forces the CommonJS entry and creates repeated critical dependency warnings: ${relative(
      root,
      nextConfigPath
    )}`
  )
}

if (!middlewareUsesStructuredDebugLogging) {
  failures.push(
    `Middleware auth diagnostics must use the production-safe logger debug path instead of raw console.log or [MIDDLEWARE DEBUG] traces:\n- ${relative(
      root,
      rootMiddlewarePath
    )}\n- ${relative(root, authMiddlewarePath)}`
  )
}

if (!avoidsLoadingStateProductionConsoleNoise) {
  failures.push(
    `Loading state hooks must keep enableLogging diagnostics development-only so production UI operations do not leak keys or error messages to the browser console: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!loadingStateAppliesOperationOptions) {
  failures.push(
    `Loading state executeAsync overrides must apply per-operation timeout, callbacks, and logging options instead of computing unused mergedOptions: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!singleLoadingStateClearsPreviousTimeout) {
  failures.push(
    `Single loading state must clear any previous timeout before starting a new operation, otherwise stale timers can fail the current operation: ${relative(
      root,
      loadingStatePath
    )}`
  )
}

if (!commentLikeButtonCleansAnimationTimer) {
  failures.push(
    `Comment like animation timers must be ref-tracked and cleared on unmount to avoid stale setState after navigation: ${relative(
      root,
      commentLikeButtonPath
    )}`
  )
}

if (!profilePhotoUploaderCleansUploadTimers) {
  failures.push(
    `Profile photo uploads must clear progress intervals and reset timers on failure, restart, and unmount: ${relative(
      root,
      profilePhotoUploaderPath
    )}`
  )
}

if (!adminSettingsCleansStatusTimers) {
  failures.push(
    `Admin settings status banners must use one ref-tracked timer that is cleared before rescheduling and on unmount: ${relative(
      root,
      adminSettingsPagePath
    )}`
  )
}

if (!sendsClientErrorReportsToApi) {
  failures.push(
    `Client ErrorTracker must send production critical errors to the existing /api/client-error collector instead of only logging a placeholder:\n- ${relative(
      root,
      errorTrackingPath
    )}\n- ${relative(root, errorBoundaryPath)}\n- ${relative(root, clientErrorApiPath)}`
  )
}

if (!redactsSecurityEventDetails) {
  failures.push(
    `Security event logging must redact URL query strings, secrets, and direct contact values at the logSecurityEvent boundary before console/webhook delivery: ${relative(
      root,
      securityPath
    )}`
  )
}

if (!avoidsArchivePreviewRawUrlLogs) {
  failures.push(
    `Archive project article preview failures must not log raw external URLs with query strings or fragments: ${relative(
      root,
      projectDetailPagePath
    )}`
  )
}

if (!avoidsServerOperationalConsoleLogs) {
  failures.push(
    `Server-side normal/fallback paths must use development-only logger.debug instead of unconditional console.log traces or URL dumps:\n- ${relative(
      root,
      cspReportPath
    )}\n- ${relative(root, authVerifySessionPath)}\n- ${relative(
      root,
      postOgImagePath
    )}\n- ${relative(root, postViewPath)}\n- ${relative(
      root,
      artistProfilePath
    )}\n- ${relative(root, cleanupTempAttachmentsPath)}\n- ${relative(root, apiPerformanceMonitorPath)}`
  )
}

if (!restrictsMediaUploadBuckets) {
  failures.push(
    `Media uploads must reject unsupported Storage buckets before service-role upload/listing: ${relative(
      root,
      mediaUploadPath
    )}`
  )
}

if (!sanitizesUploadMetadata) {
  failures.push(
    `Upload APIs must not let client-provided metadata override server-derived file truth; sanitize generic metadata and derive artist photo dimensions server-side:\n- ${relative(
      root,
      mediaUploadPath
    )}\n- ${relative(root, artistPhotoPath)}`
  )
}

if (!cleanupSkipsUnsafeTempAttachmentUrls) {
  failures.push(
    `Temporary attachment cleanup must skip malformed or non-temp Storage URLs without aborting expired DB row cleanup: ${relative(
      root,
      cleanupTempAttachmentsPath
    )}`
  )
}

if (unsafeSearchParamIntegerParsers.length > 0) {
  failures.push(
    `Search param integer parsing must use parseIntegerParam to avoid NaN pagination/range values:\n${unsafeSearchParamIntegerParsers
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (jsonBodyEmptyObjectFallbacks.length > 0) {
  failures.push(
    `Malformed JSON bodies must return explicit 400 responses instead of falling back to {}:\n${jsonBodyEmptyObjectFallbacks
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (adminMutationJsonBypasses.length > 0) {
  failures.push(
    `Admin API routes must use parseJsonObjectBody for JSON mutation payloads:\n${adminMutationJsonBypasses
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (unsafeBlankWindowOpeners.length > 0) {
  failures.push(
    `window.open(..., '_blank') must include noopener,noreferrer features:\n${unsafeBlankWindowOpeners
      .map(file => `- ${file}`)
      .join('\n')}`
  )
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}

console.log('Runtime risk checks passed')
