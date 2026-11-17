import jwt from 'jsonwebtoken';
import { getJwtSignKey } from '../model/connectors/properties.js';

export default function socketHandler(io) {
    io.on('connect', (socket) => {
  
      socket.on('auth', (token) => {
        jwt.verify(token, getJwtSignKey(), (err, user) => {
          if (err) {
            console.error(err.message);
            return;
          }
          socket.join(user.userId);
        });
      });
  
      socket.on('disconnect', () => {
      });
    });
  }
