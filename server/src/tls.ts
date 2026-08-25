
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

const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000

export type TlsMaterial = {
    cert: string
    key: string
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

function certCount(pem: string): number {
    return pem.split('-----BEGIN CERTIFICATE-----').length - 1
}

async function withIntermediates(leaf: string): Promise<string> {
    const aia = new X509Certificate(leaf).infoAccess ?? ''
    const issuerUrl = aia.match(/CA Issuers - URI:(\S+)/)?.[1]
    if (!issuerUrl) return leaf

    const res = await fetch(issuerUrl)
    if (!res.ok) throw new Error(`issuer fetch returned ${res.status}`)
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

    if (!cert.includes('BEGIN CERTIFICATE')) throw new Error('response was not a certificate')
    if (!key.includes('PRIVATE KEY')) throw new Error('response was not a private key')
    const remaining = msUntilExpiry(cert)
    if (remaining === null) throw new Error('certificate could not be parsed')
    if (remaining <= 0) throw new Error('certificate is already expired')

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
        if (cached && remaining !== null && remaining > 0) {
            log.server.warn(`HTTPS: refresh failed (${why}), using the cached certificate`)
            return { ...cached, host: hostForIp(ip), ip }
        }
        log.server.warn(`HTTPS: unavailable (${why}), staying HTTP-only`)
        return null
    }
}
