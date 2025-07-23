/*
 * GPS NTP Server Monitor - Cockpit Plugin
 * Monitor GPS time synchronization and NTP client connections
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { List, ListItem } from "@patternfly/react-core/dist/esm/components/List/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

interface NTPSource {
    name: string;
    stratum: string;
    poll: string;
    reach: string;
    lastRx: string;
    lastSample: string;
    status: string;
    offset: string;
    type: string;
    reachabilityPercent: number;
    lastContact: string;
}

interface NTPClient {
    hostname: string;
    ntpRequests: string;
    ntpDrop: string;
    ntpInterval: string;
    ntpIntervalLast: string;
    ntpLast: string;
    cmdRequests: string;
    cmdDrop: string;
    cmdInterval: string;
    cmdLast: string;
}

interface GPSInfo {
    status: string;
    satellites: string;
    latitude: string;
    longitude: string;
    altitude: string;
    mode: string;
    hdop: string;
    pdop: string;
    vdop: string;
    speed: string;
    climb: string;
    time: string;
    ept: string;
    satellitesVisible: number;
    satellitesUsed: number;
    bestSatellite: { prn: string, ss: number } | null;
}

interface PPSInfo {
    available: boolean;
    offset: string;
    jitter: string;
    frequency: string;
    skew: string;
    stratum: string;
    refId: string;
    systemTime: string;
    lastOffset: string;
    rmsOffset: string;
    updateInterval: string;
}

export const Application = () => {
    const [hostname, setHostname] = useState('');
    const [sources, setSources] = useState<NTPSource[]>([]);
    const [clients, setClients] = useState<NTPClient[]>([]);
    const [gpsStatus, setGpsStatus] = useState('Unknown');
    const [gpsInfo, setGpsInfo] = useState<GPSInfo>({ 
        status: 'Unknown', 
        satellites: '0', 
        latitude: 'N/A', 
        longitude: 'N/A', 
        altitude: 'N/A', 
        mode: 'N/A',
        hdop: 'N/A',
        pdop: 'N/A', 
        vdop: 'N/A',
        speed: 'N/A',
        climb: 'N/A',
        time: 'N/A',
        ept: 'N/A',
        satellitesVisible: 0,
        satellitesUsed: 0,
        bestSatellite: null
    });
    const [ppsInfo, setPpsInfo] = useState<PPSInfo>({
        available: false,
        offset: 'N/A',
        jitter: 'N/A',
        frequency: 'N/A',
        skew: 'N/A',
        stratum: 'N/A',
        refId: 'N/A',
        systemTime: 'N/A',
        lastOffset: 'N/A',
        rmsOffset: 'N/A',
        updateInterval: 'N/A'
    });
    const [loading, setLoading] = useState(false);

    const fetchNTPStatus = async () => {
        try {
            // Get chrony sources
            const sourcesProc = cockpit.spawn(['chronyc', 'sources', '-v'], { superuser: 'try' });
            sourcesProc.done((data) => {
                const lines = data.split('\n');
                const sourceData: NTPSource[] = [];
                
                for (const line of lines) {
                    if (line.startsWith('^') || line.startsWith('#') || line.startsWith('*') || line.startsWith('+') || line.startsWith('-') || line.startsWith('x') || line.startsWith('~') || line.startsWith('?')) {
                        const parts = line.split(/\s+/);
                        if (parts.length >= 7) {
                            const reach = parts[4] || '0';
                            const reachBinary = parseInt(reach, 8).toString(2).padStart(8, '0');
                            const reachabilityPercent = (reachBinary.split('1').length - 1) / 8 * 100;
                            
                            // Calculate last contact time based on reach register
                            let lastContactSec = 0;
                            for (let i = 0; i < 8; i++) {
                                if (reachBinary[7 - i] === '1') {
                                    lastContactSec = i * Math.pow(2, parseInt(parts[3] || '6'));
                                    break;
                                }
                            }
                            
                            const lastContact = lastContactSec === 0 ? 'Now' : 
                                lastContactSec < 60 ? `${lastContactSec}s ago` :
                                lastContactSec < 3600 ? `${Math.round(lastContactSec / 60)}m ago` :
                                `${Math.round(lastContactSec / 3600)}h ago`;
                            
                            // Parse the "Last sample" field which contains the offset
                            // Format: xxxx[yyyy] +/- zzzz where xxxx is the adjusted offset
                            let offset = 'N/A';
                            const lastSampleIndex = parts.findIndex(part => part.includes('[') || part.includes('us') || part.includes('ms') || part.includes('ns'));
                            if (lastSampleIndex !== -1) {
                                // Find the offset value (first part before the bracket)
                                const offsetMatch = parts[lastSampleIndex].match(/^([+-]?[0-9.]+[a-zA-Z]+)/);
                                if (offsetMatch) {
                                    offset = offsetMatch[1];
                                }
                            }
                            
                            sourceData.push({
                                name: parts[1] || 'Unknown',
                                stratum: parts[2] || '0',
                                poll: parts[3] || '0',
                                reach: reach,
                                lastRx: parts[5] || '-',
                                lastSample: parts.slice(6).join(' ') || '0',
                                status: line[0],
                                offset: offset,
                                type: line[0] === '#' ? 'Local Reference' : 'Network Source',
                                reachabilityPercent: Math.round(reachabilityPercent),
                                lastContact: lastContact
                            });
                        }
                    }
                }
                setSources(sourceData);
                
                // Check for GPS source
                const hasGPS = sourceData.some(s => s.name.includes('GPS') || s.name.includes('PPS'));
                setGpsStatus(hasGPS ? "Active" : "Not detected");
                
                // Get GPS information
                const gpsProc = cockpit.spawn(['gpsd', '-V'], { superuser: 'try' });
                gpsProc.done(() => {
                    // Try to get GPS status from gpspipe
                    const gpsStatusProc = cockpit.spawn(['timeout', '3', 'gpspipe', '-w', '-n', '10'], { superuser: 'try' });
                    gpsStatusProc.done((gpsData) => {
                        try {
                            const lines = gpsData.split('\n');
                            let tpvData = null;
                            let skyData = null;
                            
                            // Parse GPS data
                            for (const line of lines) {
                                if (line.trim()) {
                                    const data = JSON.parse(line);
                                    // Fix: Check if lat and lon are defined numbers, not truthy (zero is valid)
                                    if (data.class === 'TPV' && typeof data.lat === 'number' && typeof data.lon === 'number') {
                                        tpvData = data;
                                    }
                                    if (data.class === 'SKY' && data.satellites) {
                                        skyData = data;
                                    }
                                }
                            }
                            
                            if (tpvData) {
                                const satUsed = skyData ? skyData.satellites.filter(sat => sat.used).length : 0;
                                const satVisible = skyData ? skyData.nSat : 0;
                                const bestSat = skyData ? 
                                    skyData.satellites.reduce((best, sat) => 
                                        sat.ss > (best?.ss || 0) ? sat : best, null) : null;
                                
                                // Determine status based on coordinates and mode
                                let gpsStatus = 'No fix';
                                let modeString = 'No Fix';
                                
                                if (tpvData.mode >= 2) {
                                    if (tpvData.lat === 0 && tpvData.lon === 0) {
                                        gpsStatus = 'Fix acquired (Timing mode)';
                                        modeString = tpvData.mode === 3 ? '3D Fix (No Position)' : '2D Fix (No Position)';
                                    } else {
                                        gpsStatus = 'Fix acquired';
                                        modeString = tpvData.mode === 3 ? '3D Fix' : '2D Fix';
                                    }
                                }
                                
                                setGpsInfo({
                                    status: gpsStatus,
                                    satellites: satUsed.toString(),
                                    latitude: tpvData.lat.toFixed(6),
                                    longitude: tpvData.lon.toFixed(6),
                                    altitude: tpvData.alt ? tpvData.alt.toFixed(1) + 'm' : 'N/A',
                                    mode: modeString,
                                    hdop: skyData?.hdop ? skyData.hdop.toFixed(2) : 'N/A',
                                    pdop: skyData?.pdop ? skyData.pdop.toFixed(2) : 'N/A',
                                    vdop: skyData?.vdop ? skyData.vdop.toFixed(2) : 'N/A',
                                    speed: tpvData.speed ? (tpvData.speed * 3.6).toFixed(1) + ' km/h' : '0.0 km/h',
                                    climb: tpvData.climb ? tpvData.climb.toFixed(1) + ' m/s' : '0.0 m/s',
                                    time: tpvData.time ? new Date(tpvData.time).toLocaleTimeString() : 'N/A',
                                    ept: tpvData.ept ? (tpvData.ept * 1000).toFixed(1) + ' ms' : 'N/A',
                                    satellitesVisible: satVisible,
                                    satellitesUsed: satUsed,
                                    bestSatellite: bestSat ? { prn: bestSat.PRN.toString(), ss: bestSat.ss } : null
                                });
                            }
                        } catch (e) {
                            // GPS data parsing failed, keep defaults
                        }
                    }).fail(() => {
                        // gpspipe not available or failed
                        setGpsInfo(prev => ({ ...prev, status: hasGPS ? 'Active' : 'Not available' }));
                    });
                }).fail(() => {
                    // GPS daemon not available
                    setGpsInfo(prev => ({ ...prev, status: 'GPS daemon not running' }));
                });
            });

            // Get chrony clients
            const clientsProc = cockpit.spawn(['chronyc', 'clients'], { superuser: 'try' });
            clientsProc.done((data) => {
                const lines = data.split('\n');
                const clientData: NTPClient[] = [];
                
                for (const line of lines) {
                    if (line && !line.startsWith('Hostname') && !line.startsWith('=')) {
                        const parts = line.split(/\s+/).filter(part => part !== '');
                        if (parts.length >= 10) {
                            clientData.push({
                                hostname: parts[0] || 'Unknown',
                                ntpRequests: parts[1] || '0',
                                ntpDrop: parts[2] || '0',
                                ntpInterval: parts[3] || '-',
                                ntpIntervalLast: parts[4] || '-',
                                ntpLast: parts[5] || '-',
                                cmdRequests: parts[6] || '0',
                                cmdDrop: parts[7] || '0',
                                cmdInterval: parts[8] || '-',
                                cmdLast: parts[9] || '-'
                            });
                        }
                    }
                }
                setClients(clientData);
            });
            
            // Get PPS and chrony tracking info
            const trackingProc = cockpit.spawn(['chronyc', 'tracking'], { superuser: 'try' });
            trackingProc.done((data) => {
                const lines = data.split('\n');
                const trackingData: any = {};
                
                for (const line of lines) {
                    if (line.includes(':')) {
                        const [key, value] = line.split(':').map(s => s.trim());
                        trackingData[key] = value;
                    }
                }
                
                // Get source statistics for PPS jitter
                const sourcestatsProc = cockpit.spawn(['chronyc', 'sourcestats'], { superuser: 'try' });
                sourcestatsProc.done((statsData) => {
                    const statsLines = statsData.split('\n');
                    let gpsStats = null;
                    
                    for (const line of statsLines) {
                        if (line.includes('GPS') && !line.startsWith('Name')) {
                            const parts = line.split(/\s+/).filter(p => p);
                            if (parts.length >= 8) {
                                gpsStats = {
                                    name: parts[0],
                                    offset: parts[6],
                                    stdDev: parts[7]
                                };
                            }
                            break;
                        }
                    }
                    
                    setPpsInfo({
                        available: !!trackingData['Reference ID'],
                        offset: gpsStats?.offset || trackingData['Last offset'] || 'N/A',
                        jitter: gpsStats?.stdDev || 'N/A',
                        frequency: trackingData['Frequency'] || 'N/A',
                        skew: trackingData['Skew'] || 'N/A',
                        stratum: trackingData['Stratum'] || 'N/A',
                        refId: trackingData['Reference ID'] || 'N/A',
                        systemTime: trackingData['System time'] || 'N/A',
                        lastOffset: trackingData['Last offset'] || 'N/A',
                        rmsOffset: trackingData['RMS offset'] || 'N/A',
                        updateInterval: trackingData['Update interval'] || 'N/A'
                    });
                }).fail(() => {
                    // sourcestats failed, use tracking data only
                    setPpsInfo(prev => ({
                        ...prev,
                        available: !!trackingData['Reference ID'],
                        frequency: trackingData['Frequency'] || 'N/A',
                        skew: trackingData['Skew'] || 'N/A',
                        stratum: trackingData['Stratum'] || 'N/A',
                        refId: trackingData['Reference ID'] || 'N/A',
                        systemTime: trackingData['System time'] || 'N/A',
                        lastOffset: trackingData['Last offset'] || 'N/A',
                        rmsOffset: trackingData['RMS offset'] || 'N/A',
                        updateInterval: trackingData['Update interval'] || 'N/A'
                    }));
                });
            }).fail(() => {
                setPpsInfo(prev => ({ ...prev, available: false }));
            });
            
            setLoading(false);
        } catch (error) {
            console.error('Error fetching NTP status:', error);
            setLoading(false);
        }
    };

    useEffect(() => {
        const hostname = cockpit.file('/etc/hostname');
        hostname.watch(content => setHostname(content?.trim() ?? ""));
        
        fetchNTPStatus();
        
        // Refresh every 30 seconds
        const interval = setInterval(fetchNTPStatus, 30000);
        
        return () => {
            hostname.close();
            clearInterval(interval);
        };
    }, []);

    const getStatusVariant = (status: string) => {
        switch (status) {
            case '*': return 'success';  // Current best source
            case '+': return 'success';  // Combined source (good)
            case '#': return 'info';     // Local reference (PPS, GPS)
            case '-': return 'warning';  // Not combined but reachable
            case 'x': return 'warning';  // False ticker
            case '~': return 'warning';  // Variable delay
            case '?': return 'danger';   // Unreachable
            default: return 'info';     // Unknown status
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case '*': return 'Current best source';
            case '+': return 'Combined source';
            case '-': return 'Not combined';
            case '#': return 'Local reference (GPS/PPS)';
            case 'x': return 'False ticker';
            case '~': return 'Variable delay';
            case '?': return 'Unreachable/Failed';
            default: return `Status: ${status}`;
        }
    };

    return (
        <div style={{height: '100vh', overflowY: 'scroll', padding: '20px'}}>
        <Grid hasGutter>
            <GridItem span={12}>
                <Alert
                    variant="info"
                    title={cockpit.format(_("GPS NTP Server - $0"), hostname)}
                />
            </GridItem>
            
            <GridItem span={6}>
                <Card>
                    <CardTitle>
                        GPS Status
                        <Button 
                            variant="link" 
                            onClick={fetchNTPStatus} 
                            isDisabled={loading}
                            style={{float: 'right'}}
                        >
                            {loading ? 'Refreshing...' : 'Refresh'}
                        </Button>
                    </CardTitle>
                    <CardBody>
                        <Alert
                            variant={gpsInfo.status.includes('Fix') ? 'success' : gpsInfo.status === 'Active' ? 'warning' : 'danger'}
                            title={`GPS Signal: ${gpsInfo.status} (${gpsInfo.mode})`}
                        />
                        {gpsInfo.latitude !== 'N/A' && (
                            <div style={{marginTop: '10px', fontSize: '0.9em'}}>
                                {parseFloat(gpsInfo.latitude) === 0 && parseFloat(gpsInfo.longitude) === 0 && (
                                    <div style={{
                                        marginBottom: '10px', 
                                        padding: '8px', 
                                        backgroundColor: '#e1f5fe', 
                                        border: '1px solid #81d4fa', 
                                        borderRadius: '4px',
                                        fontSize: '0.85em',
                                        color: '#0d47a1'
                                    }}>
                                        <strong>ℹ️ Timing Mode:</strong> This GPS receiver is operating in timing-only mode. 
                                        It provides accurate time synchronization but no position data. 
                                        This is normal for timing-focused GPS modules like the u-blox LEA-6T.
                                    </div>
                                )}
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px'}}>
                                    <div>
                                        <strong>Position:</strong><br/>
                                        Lat: {gpsInfo.latitude}<br/>
                                        Lon: {gpsInfo.longitude}<br/>
                                        <strong>Altitude:</strong> {gpsInfo.altitude}
                                    </div>
                                    <div>
                                        <strong>Motion:</strong><br/>
                                        Speed: {gpsInfo.speed}<br/>
                                        Climb: {gpsInfo.climb}<br/>
                                        <strong>GPS Time:</strong> {gpsInfo.time}
                                    </div>
                                </div>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px'}}>
                                    <div>
                                        <strong>Satellites:</strong><br/>
                                        Used: {gpsInfo.satellites}/{gpsInfo.satellitesVisible}<br/>
                                        {gpsInfo.bestSatellite && (
                                            <span>Best: PRN {gpsInfo.bestSatellite.prn} ({gpsInfo.bestSatellite.ss} dB)</span>
                                        )}
                                    </div>
                                    <div>
                                        <strong>Precision (DOP):</strong><br/>
                                        HDOP: {gpsInfo.hdop}<br/>
                                        PDOP: {gpsInfo.pdop}<br/>
                                        VDOP: {gpsInfo.vdop}
                                    </div>
                                    <div>
                                        <strong>Time Accuracy:</strong><br/>
                                        EPT: {gpsInfo.ept}<br/>
                                        <div style={{
                                            marginTop: '5px',
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            backgroundColor: 
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 2 ? '#d4edda' :
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 5 ? '#fff3cd' : '#f8d7da',
                                            color: 
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 2 ? '#155724' :
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 5 ? '#856404' : '#721c24',
                                            fontSize: '0.8em',
                                            textAlign: 'center'
                                        }}>
                                            {
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 2 ? 'Excellent' :
                                                gpsInfo.hdop !== 'N/A' && parseFloat(gpsInfo.hdop) < 5 ? 'Good' : 'Poor'
                                            } precision
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardBody>
                </Card>
            </GridItem>
            
            <GridItem span={6}>
                <Card>
                    <CardTitle>PPS Accuracy</CardTitle>
                    <CardBody>
                        <Alert
                            variant={ppsInfo.available ? 'success' : 'danger'}
                            title={`PPS: ${ppsInfo.available ? 'Active' : 'Not Available'}`}
                        />
                        {ppsInfo.available && (
                            <div style={{marginTop: '10px', fontSize: '0.85em'}}>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px'}}>
                                    <div>
                                        <strong>Stratum:</strong> {ppsInfo.stratum}<br/>
                                        <strong>Ref ID:</strong> {ppsInfo.refId}<br/>
                                        <strong>Frequency:</strong> {ppsInfo.frequency}
                                    </div>
                                    <div>
                                        <strong>System Time:</strong><br/>
                                        <span style={{fontSize: '0.9em'}}>{ppsInfo.systemTime}</span><br/>
                                        <strong>Update:</strong> {ppsInfo.updateInterval}
                                    </div>
                                </div>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '0.8em'}}>
                                    <div style={{textAlign: 'center', padding: '4px', backgroundColor: '#f8f9fa', borderRadius: '3px'}}>
                                        <strong>Last Offset</strong><br/>
                                        <span style={{color: '#007bff'}}>{ppsInfo.lastOffset}</span>
                                    </div>
                                    <div style={{textAlign: 'center', padding: '4px', backgroundColor: '#f8f9fa', borderRadius: '3px'}}>
                                        <strong>RMS Offset</strong><br/>
                                        <span style={{color: '#28a745'}}>{ppsInfo.rmsOffset}</span>
                                    </div>
                                    <div style={{textAlign: 'center', padding: '4px', backgroundColor: '#f8f9fa', borderRadius: '3px'}}>
                                        <strong>Skew</strong><br/>
                                        <span style={{color: '#dc3545'}}>{ppsInfo.skew}</span>
                                    </div>
                                </div>
                                {ppsInfo.jitter !== 'N/A' && (
                                    <div style={{marginTop: '8px', textAlign: 'center', padding: '4px', backgroundColor: '#e9ecef', borderRadius: '3px'}}>
                                        <strong>GPS Jitter:</strong> <span style={{color: '#6c757d'}}>{ppsInfo.jitter}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardBody>
                </Card>
            </GridItem>
            
            <GridItem span={12}>
                <Card>
                    <CardTitle>NTP Clients ({clients.length})</CardTitle>
                    <CardBody style={{maxHeight: '300px', overflowY: 'auto'}}>
                        {clients.length > 0 ? (
                            <List>
                                {clients.map((client, index) => (
                                    <ListItem key={index}>
                                        <div style={{fontSize: '0.9em'}}>
                                            <div style={{fontWeight: 'bold', marginBottom: '4px'}}>
                                                {client.hostname}
                                            </div>
                                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.85em', color: '#666'}}>
                                                <div>
                                                    <strong>NTP:</strong> {client.ntpRequests} req, {client.ntpDrop} drop<br/>
                                                    <strong>Interval:</strong> {client.ntpInterval} ({client.ntpIntervalLast})<br/>
                                                    <strong>Last NTP:</strong> {client.ntpLast === '-' ? 'Never' : client.ntpLast + 's ago'}
                                                </div>
                                                <div>
                                                    <strong>CMD:</strong> {client.cmdRequests} req, {client.cmdDrop} drop<br/>
                                                    <strong>CMD Int:</strong> {client.cmdInterval}<br/>
                                                    <strong>Last CMD:</strong> {client.cmdLast === '-' ? 'Never' : client.cmdLast + 's ago'}
                                                </div>
                                            </div>
                                        </div>
                                    </ListItem>
                                ))}
                            </List>
                        ) : (
                            <Alert variant="info" title="No active clients" />
                        )}
                    </CardBody>
                </Card>
            </GridItem>
            
            <GridItem span={12}>
                <Card>
                    <CardTitle>Time Sources</CardTitle>
                    <CardBody>
                        {sources.length > 0 ? (
                            <List>
                                {sources.map((source, index) => (
                                    <ListItem key={index}>
                                        <div style={{border: '1px solid #e6e6e6', borderRadius: '8px', padding: '12px', marginBottom: '8px'}}>
                                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px'}}>
                                                <div>
                                                    <Alert
                                                        variant={getStatusVariant(source.status)}
                                                        isInline
                                                        title={`${source.name} (${source.type})`}
                                                        style={{marginBottom: '0'}}
                                                    />
                                                    <div style={{fontSize: '0.85em', color: '#666', marginTop: '4px'}}>
                                                        <strong>Status:</strong> {getStatusText(source.status)}
                                                    </div>
                                                </div>
                                                <div style={{textAlign: 'right', fontSize: '0.8em'}}>
                                                    <div style={{
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        backgroundColor: source.reachabilityPercent >= 75 ? '#d4edda' : source.reachabilityPercent >= 50 ? '#fff3cd' : '#f8d7da',
                                                        color: source.reachabilityPercent >= 75 ? '#155724' : source.reachabilityPercent >= 50 ? '#856404' : '#721c24',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {source.reachabilityPercent}% Reachable
                                                    </div>
                                                    <div style={{marginTop: '4px', color: '#666'}}>
                                                        Last: {source.lastContact}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', fontSize: '0.85em'}}>
                                                <div style={{textAlign: 'center', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                                                    <div style={{fontWeight: 'bold', color: '#495057'}}>Stratum</div>
                                                    <div style={{color: '#007bff', fontWeight: 'bold'}}>{source.stratum}</div>
                                                </div>
                                                <div style={{textAlign: 'center', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                                                    <div style={{fontWeight: 'bold', color: '#495057'}}>Poll Interval</div>
                                                    <div style={{color: '#28a745'}}>{Math.pow(2, parseInt(source.poll || '6'))}s</div>
                                                </div>
                                                <div style={{textAlign: 'center', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                                                    <div style={{fontWeight: 'bold', color: '#495057'}}>Offset</div>
                                                    <div style={{
                                                        color: Math.abs(parseFloat(source.offset.replace('ms', '').replace('us', '').replace('ns', ''))) < 100 ? '#28a745' : 
                                                               Math.abs(parseFloat(source.offset.replace('ms', '').replace('us', '').replace('ns', ''))) < 1000 ? '#ffc107' : '#dc3545',
                                                        fontWeight: 'bold'
                                                    }}>{source.offset}</div>
                                                </div>
                                                <div style={{textAlign: 'center', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '4px'}}>
                                                    <div style={{fontWeight: 'bold', color: '#495057'}}>Reach Register</div>
                                                    <div style={{fontFamily: 'monospace', fontSize: '0.8em'}}>{source.reach}</div>
                                                </div>
                                            </div>
                                            {source.reachabilityPercent < 50 && (
                                                <div style={{marginTop: '8px', padding: '6px', backgroundColor: '#f8d7da', borderRadius: '4px', fontSize: '0.8em', color: '#721c24'}}>
                                                    <strong>Warning:</strong> Low reachability may indicate network issues or source problems
                                                </div>
                                            )}
                                        </div>
                                    </ListItem>
                                ))}
                            </List>
                        ) : (
                            <Alert variant="warning" title="No time sources configured" />
                        )}
                    </CardBody>
                </Card>
            </GridItem>
        </Grid>
        </div>
    );
};
