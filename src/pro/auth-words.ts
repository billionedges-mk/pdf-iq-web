/**
 * What a failed sign-in says, by kind (src/pro/auth.ts sorts errors into kinds). Shared by /account/ and /pro/buy/, so a
 * sign-in that fails on either page says the same true thing. The test for each: is it true about what the person can
 * do? "again" is true only where signing in again can fix it.
 */
import type { AuthErrorKind } from './auth.js';

export const WORDS: Record<AuthErrorKind, { title: string; body: string; again: boolean }> = {
  cancelled: {
    title: 'You came back without signing in.',
    body: 'Nothing was kept. Nothing on this site needs an account except Pro, so there is no need to try again unless you want to.',
    again: true,
  },
  forged: {
    title: 'That sign-in did not start on this page, so it was ignored.',
    body: 'Google sent back an answer that does not match a sign-in this browser began — from another tab, perhaps, or an old link. Nothing was kept. Starting again from here fixes it.',
    again: true,
  },
  offline: {
    title: 'You are offline.',
    body: 'Signing in needs a connection to Google. The tools do not: they keep working without one.',
    again: true,
  },
  'not-configured': {
    title: 'Signing in is not set up correctly on our side.',
    body: 'Nothing you can do here will fix it, and nothing on your device is wrong. The tools work as normal without an account.',
    again: false,
  },
  'app-check': {
    title: 'Signing in from the website is switched off on our side.',
    body: 'Nothing on your device is wrong, and signing in again will not help. The tools work as normal without an account; anything in Pro that needs one will not work until this is back.',
    again: false,
  },
  ended: {
    title: 'The sign-in kept in this browser has ended.',
    body: 'Google no longer accepts it. Signing in again fixes that.',
    again: true,
  },
  disabled: {
    title: 'This account has been switched off.',
    body: 'Signing in again will not change that. Write to support@pdf-iq.com if you think it is a mistake.',
    again: false,
  },
  storage: {
    title: 'This browser is not letting the site keep anything, so a sign-in cannot be remembered.',
    body: 'Private browsing does this, and so does blocking site data. In a normal window it works; the tools work either way.',
    again: false,
  },
  unknown: {
    title: 'Signing in did not work, and we could not tell why.',
    body: 'The line below is what came back. Trying again may work; if it does not, that line is what to send to support@pdf-iq.com.',
    again: true,
  },
};
