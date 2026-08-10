/**
 * TLS for the LAN, so a phone can install the PWA.
 *
 * Android refuses to install a PWA (or register a service worker) from an
 * insecure origin, and `http://192.168.x.x` is insecure. A self-signed cert
 * doesn't help either — it has to be trusted, which normally means installing a
 * CA on every device by hand.
 *
 * The trick this uses instead: `local-ip.co` runs public DNS where the hostname
 * encodes the address — `192-168-0-160.my.local-ip.co` resolves to
 * 192.168.0.160 — and publishes a genuine, publicly-trusted wildcard
 * certificate for `*.my.local-ip.co`, private key and all. Every device already
 * trusts it, so there is nothing to install anywhere.
 *
 * ⚠ THE KEY IS PUBLIC. Anyone can download it, so anyone on the same network
 * can impersonate or decrypt this origin. It buys *installability*, not
 * confidentiality — treat an HTTPS LAN session as no more private than the
 * plain HTTP one, and remember this app carries provider API keys when a model
 * is edited. That is why it is opt-in, and why the plain HTTP listener is
 * untouched.
 *
 * Let's Encrypt can't replace this: HTTP-01 needs the CA to reach the host from
 * the internet, which a private address can't offer, and DNS-01 needs control
 * of the zone, which we don't have for someone else's domain.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import { DATA_DIR } from './paths'
import { log } from './logger'

const TLS_DIR = path.join(DATA_DIR, 'tls')
const CERT_PATH = path.join(TLS_DIR, 'server.pem')
const KEY_PATH = path.join(TLS_DIR, 'server.key')

const CERT_URL = 'https://local-ip.co/cert/server.pem'
const KEY_URL = 'https://local-ip.co/cert/server.key'

/** Refetch this far ahead of expiry, so a cert never lapses mid-session. */
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000

export type TlsMaterial = {
    cert: string
    key: string
    /** The hostname the cert is valid for, e.g. `192-168-0-160.my.local-ip.co`. */
    host: string
    ip: string
}

/**
 * This machine's LAN address — the one a phone can reach.
 *
 * Skips loopback and link-local (169.254.x, handed out when DHCP failed and
 * routable from nothing). Returns null when there's no such interface, which is
 * a legitimate state: a machine with only loopback has no LAN to serve.
 */
export function lanAddress(): string | null {
    for (const addrs of Object.values(os.networkInterfaces())) {
        for (const addr of addrs ?? []) {
            if (addr.family !== 'IPv4' || addr.internal) continue
            if (addr.address.startsWith('169.254.')) continue
            return addr.address
        }
    }
    return null
}

/** `192.168.0.160` → `192-168-0-160.my.local-ip.co` */
export function hostForIp(ip: string): string {
    return `${ip.replace(/\./g, '-')}.my.local-ip.co`
}

/** ms until the cert expires, or null if it can't be read as a certificate. */
function msUntilExpiry(pem: string): number | null {
    try {
        const validTo = new Date(new X509Certificate(pem).validTo).getTime()
        return Number.isFinite(validTo) ? validTo - Date.now() : null
    } catch {
        return null
    }
}

function readCached(): { cert: string; key: string } | null {
    try {
        const cert = fs.readFileSync(CERT_PATH, 'utf8')
        const key = fs.readFileSync(KEY_PATH, 'utf8')
        if (!cert.includes('BEGIN CERTIFICATE') || !key.includes('PRIVATE KEY')) return null
        return { cert, key }
    } catch {
        return null
    }
}

/** How many certificates a PEM bundle holds. */
function certCount(pem: string): number {
    return pem.split('-----BEGIN CERTIFICATE-----').length - 1
}

/**
 * Append the issuing intermediate, so the server presents a complete chain.
 *
 * local-ip.co serves the leaf on its own. Desktop browsers hide that: Windows
 * and macOS quietly fetch the missing issuer over AIA and cache it, so it looks
 * fine on the machine you're developing on. **Android does not do AIA
 * fetching** — Chrome there sees an unverifiable chain and refuses the origin
 * outright, which is exactly the device this whole feature exists for.
 *
 * The issuer URL is read from the leaf's own AIA extension rather than
 * hardcoded, so this keeps working when the service re-issues under a different
 * CA (its published `chain.pem` is currently a stale Sectigo chain for a
 * GlobalSign leaf, which is what hardcoding gets you).
 */
async function withIntermediates(leaf: string): Promise<string> {
    const aia = new X509Certificate(leaf).infoAccess ?? ''
    const issuerUrl = aia.match(/CA Issuers - URI:(\S+)/)?.[1]
    if (!issuerUrl) return leaf

    const res = await fetch(issuerUrl)
    if (!res.ok) throw new Error(`issuer fetch returned ${res.status}`)
    // Served as DER; X509Certificate accepts the raw bytes and re-emits PEM.
    const der = Buffer.from(await res.arrayBuffer())
    const intermediate = new X509Certificate(der).toString()
    return `${leaf.trimEnd()}
${intermediate}`
}

async function fetchPair(): Promise<{ cert: string; key: string }> {
    const [certRes, keyRes] = await Promise.all([fetch(CERT_URL), fetch(KEY_URL)])
    if (!certRes.ok || !keyRes.ok) {
        throw new Error(`local-ip.co returned ${certRes.status}/${keyRes.status}`)
    }
    const [cert, key] = await Promise.all([certRes.text(), keyRes.text()])

    // Validate before writing: a captive portal or an error page would
    // otherwise be cached as a "certificate" and fail at bind time every boot.
    if (!cert.includes('BEGIN CERTIFICATE')) throw new Error('response was not a certificate')
    if (!key.includes('PRIVATE KEY')) throw new Error('response was not a private key')
    const remaining = msUntilExpiry(cert)
    if (remaining === null) throw new Error('certificate could not be parsed')
    if (remaining <= 0) throw new Error('certificate is already expired')

    // A leaf-only chain still works on desktop, so failing the whole fetch here
    // would trade a phone-only problem for an everywhere problem.
    let full = cert
    try {
        full = await withIntermediates(cert)
    } catch (err) {
        log.server.warn(`HTTPS: could not fetch the issuing intermediate (${err instanceof Error ? err.message : err}); phones may reject this certificate`)
    }

    return { cert: full, key }
}

function writePair(pair: { cert: string; key: string }): void {
    fs.mkdirSync(TLS_DIR, { recursive: true })
    // Written to a temp name and renamed: rename is atomic within a
    // filesystem, so a crash mid-write can't leave a half a certificate behind
    // for the next boot to trust.
    for (const [file, contents] of [[CERT_PATH, pair.cert], [KEY_PATH, pair.key]] as const) {
        const tmp = `${file}.partial`
        fs.writeFileSync(tmp, contents)
        fs.renameSync(tmp, file)
    }
}

/**
 * Produce usable TLS material, fetching or refreshing as needed.
 *
 * Returns null rather than throwing on every failure path — no LAN address, no
 * network, service down, junk response. HTTPS here is an enhancement; losing it
 * must never stop the app from starting on HTTP.
 */
export async function ensureCert(): Promise<TlsMaterial | null> {
    const ip = lanAddress()
    if (!ip) {
        log.server.warn('HTTPS: no LAN address on this machine, staying HTTP-only')
        return null
    }

    const cached = readCached()
    const remaining = cached ? msUntilExpiry(cached.cert) : null
    // A single-certificate bundle predates chain building (or its intermediate
    // fetch failed). Refetch rather than serve something Android will reject.
    const chainComplete = cached ? certCount(cached.cert) >= 2 : false
    if (cached && chainComplete && remaining !== null && remaining > RENEW_BEFORE_MS) {
        const days = Math.floor(remaining / 86_400_000)
        log.server.info(`HTTPS: using cached certificate (${days}d left)`)
        return { ...cached, host: hostForIp(ip), ip }
    }

    try {
        const fetched = await fetchPair()
        writePair(fetched)
        const days = Math.floor((msUntilExpiry(fetched.cert) ?? 0) / 86_400_000)
        log.server.ok(`HTTPS: fetched certificate from local-ip.co (${days}d left)`)
        return { ...fetched, host: hostForIp(ip), ip }
    } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        // An expiring-but-still-valid cached cert beats no HTTPS at all, so a
        // failed refresh falls back to it rather than discarding it.
        if (cached && remaining !== null && remaining > 0) {
            log.server.warn(`HTTPS: refresh failed (${why}), using the cached certificate`)
            return { ...cached, host: hostForIp(ip), ip }
        }
        log.server.warn(`HTTPS: unavailable (${why}), staying HTTP-only`)
        return null
    }
}
