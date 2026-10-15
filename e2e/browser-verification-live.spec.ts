import { expect, test } from '@playwright/test';
import path from 'path';

test.describe('Live Browser Verification: Image Upload & Organizer Refunds', () => {
  test('verifies real cover and gallery upload, save, reload persistence, and public display against live API', async ({
    page,
  }) => {
    // 1. Log in via UI
    await page.goto('http://localhost:3000/signin');
    await page.fill('#email', 'demo.organizer@eventai.test');
    await page.fill('#password', 'DemoPass123');
    await page.click('button[type="submit"]');

    // Wait for login redirection
    await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 15000 });

    // 2. Navigate to real event manage page
    const eventId = '63c65883-28f8-47d9-bb78-67a37d644079';
    await page.goto(`http://localhost:3000/organizer/events/${eventId}`);
    await expect(page.getByText('Mumbai Indie Night')).toBeVisible({ timeout: 15000 });

    // 3. Switch to Media & Policies step (Step 4)
    const mediaStepButton = page.getByRole('button', { name: /Media & Policies/i });
    await expect(mediaStepButton).toBeVisible();
    await mediaStepButton.click();

    // Verify media section is visible
    await expect(page.getByText('Event cover image')).toBeVisible();

    // 4. Upload actual cover image file
    const coverPath = path.join(
      'C:\\Users\\tarun\\.gemini\\antigravity-ide\\brain\\1c32cb21-a752-4948-b6b8-e36f5d15d0c5\\scratch\\test-cover.png',
    );
    const coverInput = page.locator('input[type="file"][accept*="image"]').first();
    await coverInput.setInputFiles(coverPath);

    // Wait for upload completion notice
    await expect(page.getByText('Cover image uploaded successfully.')).toBeVisible({ timeout: 15000 });

    // Expect cover image preview to render
    const coverPreview = page.locator('img[alt="Event cover preview"]');
    await expect(coverPreview).toBeVisible({ timeout: 15000 });
    const coverSrc = await coverPreview.getAttribute('src');
    expect(coverSrc).toMatch(/\/uploads\/event-/);

    // 5. Upload actual gallery image file
    const galleryPath = path.join(
      'C:\\Users\\tarun\\.gemini\\antigravity-ide\\brain\\1c32cb21-a752-4948-b6b8-e36f5d15d0c5\\scratch\\test-gallery.png',
    );
    const galleryInput = page.locator('input[type="file"][multiple]');
    await galleryInput.setInputFiles(galleryPath);

    // Wait for gallery upload completion notice
    await expect(page.getByText(/gallery image.* added/)).toBeVisible({ timeout: 15000 });

    // Expect gallery preview to appear in the gallery grid
    const galleryPreview = page.locator('img[alt^="Gallery item"]').first();
    await expect(galleryPreview).toBeVisible({ timeout: 15000 });
    const gallerySrc = await galleryPreview.getAttribute('src');
    expect(gallerySrc).toMatch(/\/uploads\/event-/);

    // 6. Save changes
    const saveButton = page.getByRole('button', { name: 'Save draft' });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Verify save success notice
    await expect(page.getByText('Draft saved.')).toBeVisible({ timeout: 15000 });

    // 7. Reload page and verify persistence
    await page.reload();
    await expect(page.getByText('Mumbai Indie Night')).toBeVisible({ timeout: 15000 });

    // Go back to Media & Policies step
    await page.getByRole('button', { name: /Media & Policies/i }).click();

    // Verify both images persisted
    const persistedCover = page.locator('img[alt="Event cover preview"]');
    await expect(persistedCover).toBeVisible();
    expect(await persistedCover.getAttribute('src')).toBe(coverSrc);

    const persistedGallery = page.locator('img[alt^="Gallery item"]').first();
    await expect(persistedGallery).toBeVisible();

    // 8. Verify public event page displays image
    await page.goto('http://localhost:3000/events/mumbai-indie-night-02c73b12');
    await expect(page.getByRole('heading', { name: 'Mumbai Indie Night' })).toBeVisible({
      timeout: 15000,
    });
    // Banner / cover image rendered on page
    const publicBanner = page.locator(`img[src*="${coverSrc}"]`).first();
    await expect(publicBanner).toBeVisible();
  });

  test('verifies live Organizer dashboard All Requests UI against refund-requests API', async ({
    page,
  }) => {
    // 1. Log in via UI
    await page.goto('http://localhost:3000/signin');
    await page.fill('#email', 'demo.organizer@eventai.test');
    await page.fill('#password', 'DemoPass123');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 15000 });

    // 2. Navigate to Organizer refunds dashboard
    await page.goto('http://localhost:3000/organizer/refunds');
    await expect(page.getByRole('heading', { name: /Refund requests/i })).toBeVisible({
      timeout: 15000,
    });

    // 3. Verify tabs exist
    await expect(page.getByRole('button', { name: /Pending review/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Approved \/ processing/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Successfully refunded/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /All requests/i })).toBeVisible();

    // 4. Click 'All requests' tab
    const allRequestsButton = page.getByRole('button', { name: /All requests/i });
    await allRequestsButton.click();

    // 5. Verify both actual requests from DB render in UI
    await expect(page.getByText('DevCon Mumbai 2026').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Approved — settlement processing').first()).toBeVisible();
    await expect(page.getByText('₹1,499').first()).toBeVisible();

    await expect(page.getByText('Mumbai Indie Night').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Successfully refunded').first()).toBeVisible();
    await expect(page.getByText('₹499').first()).toBeVisible();

    // 6. Test 'Approved / processing' filter tab
    await page.getByRole('button', { name: /Approved \/ processing/i }).click();
    await expect(page.getByText('DevCon Mumbai 2026').first()).toBeVisible({ timeout: 10000 });

    // 7. Test 'Successfully refunded' filter tab
    await page.getByRole('button', { name: /Successfully refunded/i }).click();
    await expect(page.getByText('Mumbai Indie Night').first()).toBeVisible({ timeout: 10000 });
  });
});
