const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('1. Testing home page...');
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(2000);
  
  // Check if navigation is visible
  const nav = await page.locator('nav').first();
  const isNavVisible = await nav.isVisible();
  console.log(`Navigation visible: ${isNavVisible}`);
  
  // Check if BOARD link exists
  const boardLink = await page.locator('text=BOARD').first();
  const isBoardLinkVisible = await boardLink.isVisible();
  console.log(`BOARD link visible: ${isBoardLinkVisible}`);
  
  // Check login/signup links
  const loginLink = await page.locator('text=로그인').first();
  const signupLink = await page.locator('text=회원가입').first();
  const isLoginVisible = await loginLink.isVisible();
  const isSignupVisible = await signupLink.isVisible();
  console.log(`Login link visible: ${isLoginVisible}`);
  console.log(`Signup link visible: ${isSignupVisible}`);
  
  console.log('\n2. Testing board page...');
  if (isBoardLinkVisible) {
    await boardLink.click();
    await page.waitForTimeout(2000);
    
    // Check page content
    const content = await page.content();
    console.log('Board page URL:', page.url());
    
    // Check if main content is visible
    const main = await page.locator('main').first();
    const isMainVisible = await main.isVisible();
    console.log(`Main content visible: ${isMainVisible}`);
    
    // Check for specific board content
    const boardTitle = await page.locator('h1').first();
    const boardTitleText = await boardTitle.textContent();
    console.log(`Board title: "${boardTitleText}"`);
    
    // Check page height
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const windowHeight = await page.evaluate(() => window.innerHeight);
    console.log(`Body height: ${bodyHeight}px, Window height: ${windowHeight}px`);
    
    // Check footer position
    const footer = await page.locator('footer').first();
    const footerBounds = await footer.boundingBox();
    console.log(`Footer position: ${footerBounds ? footerBounds.y : 'not found'}`);
  }
  
  console.log('\n3. Testing login page...');
  await page.goto('http://localhost:3001/login');
  await page.waitForTimeout(2000);
  
  // Check login page content
  const loginTitle = await page.locator('h2').first();
  const loginTitleText = await loginTitle.textContent();
  console.log(`Login title: "${loginTitleText}"`);
  
  // Check if form exists
  const form = await page.locator('form').first();
  const isFormVisible = await form.isVisible();
  console.log(`Login form visible: ${isFormVisible}`);
  
  console.log('\n4. Testing signup page...');
  await page.goto('http://localhost:3001/signup');
  await page.waitForTimeout(2000);
  
  // Check signup page content
  const signupTitle = await page.locator('h2').first();
  const signupTitleText = await signupTitle.textContent();
  console.log(`Signup title: "${signupTitleText}"`);
  
  // Check page structure
  const signupForm = await page.locator('form').first();
  const isSignupFormVisible = await signupForm.isVisible();
  console.log(`Signup form visible: ${isSignupFormVisible}`);
  
  // Take screenshots for debugging
  await page.screenshot({ path: 'signup-page.png', fullPage: true });
  console.log('Screenshot saved as signup-page.png');
  
  await browser.close();
})();