import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { RedisService } from '../redis/redis.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: 'streams',
  cors: { origin: '*' },
})
export class StreamsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StreamsGateway.name);

  constructor(private readonly redis: RedisService) {}

  async handleDisconnect(client: { id: string }) {
    const streamId = (client as unknown as { streamId?: string }).streamId;
    if (streamId) {
      const key = this.redis.streamViewersKey(streamId);
      await this.redis.srem(key, client.id);
      const count = await this.redis.scard(key);
      this.server
        .to(`stream:${streamId}`)
        .emit('viewer_count', { streamId, count });
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @MessageBody() payload: { streamId: string },
    @ConnectedSocket() client: { id: string; join: (room: string) => void },
  ) {
    const { streamId } = payload;
    if (!streamId) return;
    const room = `stream:${streamId}`;
    (client as unknown as { streamId?: string }).streamId = streamId;
    client.join(room);
    const key = this.redis.streamViewersKey(streamId);
    await this.redis.sadd(key, client.id);
    const count = await this.redis.scard(key);
    this.server.to(room).emit('viewer_count', { streamId, count });
    this.logger.log(`Client ${client.id} joined stream ${streamId}`);
  }

  @SubscribeMessage('chat_message')
  handleChatMessage(
    @MessageBody()
    payload: { streamId: string; message: string; senderName?: string },
    @ConnectedSocket() client: { id: string },
  ) {
    const { streamId, message, senderName } = payload;
    if (!streamId || !message) return;
    const room = `stream:${streamId}`;
    this.server.to(room).emit('new_message', {
      streamId,
      message,
      senderName: senderName ?? 'Anonymous',
      senderId: client.id,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('like_stream')
  handleLikeStream(
    @MessageBody() payload: { streamId: string },
    @ConnectedSocket() client: { id: string },
  ) {
    const { streamId } = payload;
    if (!streamId) return;
    const room = `stream:${streamId}`;
    this.server.to(room).emit('floating_hearts', { streamId, from: client.id });
  }

  @SubscribeMessage('pin_product')
  handlePinProduct(
    @MessageBody()
    payload: {
      streamId: string;
      productId: string;
      productName?: string;
    },
  ) {
    const { streamId, productId, productName } = payload;
    if (!streamId || !productId) return;
    const room = `stream:${streamId}`;
    this.server.to(room).emit('pinned_product', {
      streamId,
      productId,
      productName: productName ?? '',
      timestamp: new Date().toISOString(),
    });
  }
}
