import { BlockList } from 'node:net';

const privateRanges = new BlockList();
// RFC 1918
privateRanges.addSubnet('10.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('172.16.0.0', 12, 'ipv4');
privateRanges.addSubnet('192.168.0.0', 16, 'ipv4');
// Loopback
privateRanges.addSubnet('127.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('::1', 128, 'ipv6');
// Link-local
privateRanges.addSubnet('169.254.0.0', 16, 'ipv4');
privateRanges.addSubnet('fe80::', 10, 'ipv6');
// IPv6 unique local
privateRanges.addSubnet('fc00::', 7, 'ipv6');

/**
 * Utility function to check if IPv4/IPv6 address is private.
 */
export function isPrivateIP(ip: string): boolean {
    return privateRanges.check(ip);
}
