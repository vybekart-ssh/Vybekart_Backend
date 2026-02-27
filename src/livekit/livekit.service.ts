import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, VideoGrant } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
  private roomService: RoomServiceClient | null = null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private url: string | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (url && apiKey && apiSecret) {
      this.url = url;
      this.apiKey = apiKey;
      this.apiSecret = apiSecret;
      this.roomService = new RoomServiceClient(url, apiKey, apiSecret);
    }
  }

  isConfigured(): boolean {
    return !!(this.url && this.apiKey && this.apiSecret && this.roomService);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
      );
    }
  }

  getLiveKitUrl(): string {
    this.assertConfigured();
    return this.url!;
  }

  /**
   * WebSocket URL for browser clients (Room.connect). Converts http(s) to ws(s).
   */
  getWebSocketUrl(): string {
    this.assertConfigured();
    const u = this.url!;
    if (u.startsWith('https://')) return u.replace('https://', 'wss://');
    if (u.startsWith('http://')) return u.replace('http://', 'ws://');
    return u;
  }

  /**
   * URL for clients (SDK) to connect. LiveKit uses 7880 for HTTP API and 7881 for WebSocket/RTC.
   * If LIVEKIT_URL uses port 7880, we return the same host with port 7881 for client connections.
   */
  getClientUrl(): string {
    this.assertConfigured();
    const u = this.url!;
    if (u.includes(':7880')) return u.replace(':7880', ':7881');
    return u;
  }

  /**
   * Create a LiveKit room for a stream. Room name = streamId.
   */
  async createRoom(roomName: string, metadata?: string): Promise<void> {
    this.assertConfigured();
    await this.roomService!.createRoom({
      name: roomName,
      emptyTimeout: 10 * 60, // 10 minutes
      maxParticipants: 500,
      metadata: metadata ?? undefined,
    });
  }

  /**
   * Delete a LiveKit room when stream ends.
   */
  async deleteRoom(roomName: string): Promise<void> {
    if (!this.roomService) return;
    try {
      await this.roomService.deleteRoom(roomName);
    } catch {
      // Room may already be gone
    }
  }

  /**
   * Generate an access token for a participant.
   * @param roomName - LiveKit room name
   * @param identity - Participant identity (e.g. user id or display name)
   * @param options - canPublish for seller, canSubscribe for viewer
   */
  async createToken(
    roomName: string,
    identity: string,
    options: { canPublish: boolean; canSubscribe: boolean },
  ): Promise<string> {
    this.assertConfigured();

    const at = new AccessToken(this.apiKey!, this.apiSecret!, {
      identity,
      ttl: '6h',
    });

    const grant: VideoGrant = {
      roomJoin: true,
      room: roomName,
      canPublish: options.canPublish,
      canSubscribe: options.canSubscribe,
    };
    at.addGrant(grant);

    return await at.toJwt();
  }

  /**
   * Create a publisher token (for seller broadcasting).
   */
  async createPublisherToken(
    roomName: string,
    identity: string,
  ): Promise<string> {
    return this.createToken(roomName, identity, {
      canPublish: true,
      canSubscribe: true,
    });
  }

  /**
   * Create a subscriber token (for viewer watching).
   */
  async createSubscriberToken(
    roomName: string,
    identity: string,
  ): Promise<string> {
    return this.createToken(roomName, identity, {
      canPublish: false,
      canSubscribe: true,
    });
  }
}
