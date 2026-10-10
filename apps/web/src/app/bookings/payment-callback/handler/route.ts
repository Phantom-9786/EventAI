import { NextRequest, NextResponse } from 'next/server';

/**
 * Razorpay callback receiver for the redirect-based checkout flow.
 *
 * Razorpay's documented `callback_url` contract is a POST with the payment
 * result in a form-encoded body:
 *  - success: `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`
 *  - failure: `error_code`, `error_description`, …
 *
 * This handler relays those values to the client-side verification page via a
 * 303 redirect (the page shape-validates and calls the API, where the HMAC
 * signature is verified server-side). It never trusts the payment on its own.
 */
export async function POST(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get('bookingId') ?? '';
  const form = await request.formData();
  const field = (key: string): string => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };

  const params = new URLSearchParams();
  if (bookingId) params.set('bookingId', bookingId);

  const errorCode = field('error_code');
  if (errorCode) {
    params.set('error_code', errorCode);
    const errorDescription = field('error_description');
    if (errorDescription) params.set('error_description', errorDescription);
  } else {
    params.set('razorpay_order_id', field('razorpay_order_id'));
    params.set('razorpay_payment_id', field('razorpay_payment_id'));
    params.set('razorpay_signature', field('razorpay_signature'));
  }

  return NextResponse.redirect(
    new URL(`/bookings/payment-callback?${params.toString()}`, request.url),
    303,
  );
}
