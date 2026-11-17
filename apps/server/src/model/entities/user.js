import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
  },
  admin: {
    type: Boolean,
    default: false 
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  avatarUrl: {
    type: String,
    required: false,
  },
  activeSessions: {
    type: [{
      token: { type: String, required: true },
      expiresAt: { type: Date, required: true },
      // A sign-in is renewed again and again (each renewal is a token of its own): they share a `sessionId`, which is what a person sees and ends.
      sessionId: { type: String },
      signedInAt: { type: Date },
      renewedAt: { type: Date },
      userAgent: { type: String },
      ip: { type: String },
    }],
    default: [],
  },
  // The git host `accessToken`/`refreshToken` (and `username`) are of; unset: the deployment's primary host, which is what
  // every user was before there could be more than one. The other hosts a person signed in to are `identities`.
  gitHost: {
    type: String,
    required: false,
  },
  // The name on `gitHost` when it is not `username` (another person already had that name on this deployment: "ana" on GitLab is
  // "ana@gitlab" here); unset: `username` is it.
  hostUsername: {
    type: String,
    required: false,
  },
  // The profile: the one host LINEA shows the lines and products of (a person can be signed in to several). Unset: their own host.
  activeHost: {
    type: String,
    required: false,
  },
  identities: {
    type: [{
      host: { type: String, required: true },
      username: { type: String, required: true },
      accessToken: { type: String },
      refreshToken: { type: String },
      avatarUrl: { type: String },
      linkedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  // An administrator switched the account off: it signs in nowhere and no token of it works.
  disabled: {
    type: Boolean,
    default: false,
  },
  // The password of a user whose own host is `local` (hashed); the other hosts' users sign in with the host.
  passwordHash: {
    type: String,
    required: false,
  },
  accessToken: {
    type: String,
    required: false,
  },
  // A local account's git token is made from this and the server's secret (see git/localToken.js), not kept: raising it renews the token.
  gitTokenVersion: {
    type: Number,
    default: 0,
  },
  refreshToken: {
    type: String,
    required: false,
  }
});

const User = mongoose.model('User', userSchema);

export default User;
