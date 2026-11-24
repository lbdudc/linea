import express from 'express';
import UserController from '../controllers/UserController.js';
import { requireAuth, requireAdmin } from '../common/auth.js';
import { Container } from 'typedi';
import { audited } from '../../model/audit.js';
import { rateLimitByIp } from '../common/rateLimit.js';
import { tokenLoginValidator, deviceCodeValidator, linkNativeValidator, loginFromGitLabValidator, loginFromGitLabNativeValidator, hostParam, localLoginValidator, profileValidator, createLocalUserValidator, setPasswordValidator, setAdminValidator, setDisabledValidator, changeOwnPasswordValidator, deleteUserValidator } from '../validators/userValidators.js';

const userRouter = express.Router();
const userController = Container.get(UserController)

userRouter.post('/loginFromServiceToken', requireAuth, userController.loginUserFromId);
// a local account signs in with its password (before `/login/:host`, which is for the hosts that give a code)
userRouter.post('/login/local', localLoginValidator, userController.loginLocal);
// the people of this server, for an administrator
userRouter.get('/', requireAdmin, userController.listUsers);
userRouter.post('/', requireAdmin, audited('user.create', { target: (req) => req.body?.username, detail: (req) => ({ admin: Boolean(req.body?.admin) }) }), createLocalUserValidator, userController.createLocalUser);
// a person's own password and git token (before the routes of an administrator, which name the account in the path)
userRouter.put('/me/password', requireAuth, changeOwnPasswordValidator, userController.changeOwnPassword);
userRouter.post('/me/git-token', requireAuth, userController.regenerateGitToken);
userRouter.get('/me/sessions', requireAuth, userController.listSessions);
userRouter.delete('/me/sessions', requireAuth, audited('user.sessions-revoked'), userController.revokeSessions);
userRouter.delete('/me/sessions/:id', requireAuth, userController.revokeSessions);
userRouter.delete('/:id/sessions', requireAdmin, audited('user.sign-out-everywhere', { target: (req) => req.params.id }), userController.signOutEverywhere);
userRouter.put('/:id/admin', requireAdmin, audited('user.admin', { target: (req) => req.params.id, detail: (req) => ({ admin: req.body?.admin }) }), setAdminValidator, userController.setAdmin);
userRouter.put('/:id/disabled', requireAdmin, audited('user.disabled', { target: (req) => req.params.id, detail: (req) => ({ disabled: req.body?.disabled }) }), setDisabledValidator, userController.setDisabled);
userRouter.delete('/:id', requireAdmin, audited('user.delete', { target: (req) => req.params.id, detail: (req) => ({ transferTo: req.query?.transferTo }) }), deleteUserValidator, userController.deleteUser);
userRouter.put('/:id/password', requireAdmin, audited('user.password-reset', { target: (req) => req.params.id }), setPasswordValidator, userController.setLocalPassword);
// from a terminal: a token of the host, or the device flow (the person approves on another screen), then the native link of an account
const perIp = rateLimitByIp(60, 60_000);
userRouter.post('/login/:host/token', perIp, hostParam, tokenLoginValidator, userController.loginWithToken);
userRouter.post('/device/:host', rateLimitByIp(20, 60_000), hostParam, userController.startDevice);
userRouter.post('/login/:host/device', perIp, hostParam, deviceCodeValidator, userController.loginWithDevice);
userRouter.post('/identities/:host/native', requireAuth, audited('user.link-host', { target: (req) => req.params.host }), hostParam, linkNativeValidator, userController.linkIdentityNative);
userRouter.post('/identities/:host/device', requireAuth, audited('user.link-host', { target: (req) => req.params.host }), hostParam, deviceCodeValidator, userController.linkIdentityDevice);
// by host: the code a host's OAuth page gave back (state carries nothing the server has to trust)
userRouter.post('/login/:host', hostParam, loginFromGitLabValidator, userController.loginUserFromGitLab);
userRouter.put('/profile', requireAuth, profileValidator, userController.setProfile);
userRouter.post('/identities/:host', requireAuth, audited('user.link-host', { target: (req) => req.params.host }), hostParam, loginFromGitLabValidator, userController.linkIdentity);
userRouter.delete('/identities/:host', requireAuth, audited('user.unlink-host', { target: (req) => req.params.host }), userController.unlinkIdentity);
userRouter.post('/loginFromGitLabNative', loginFromGitLabNativeValidator, userController.loginUserFromGitLabNative);
userRouter.post('/login/:host/native', hostParam, loginFromGitLabNativeValidator, userController.loginUserFromGitLabNative);
userRouter.post('/logout', requireAuth, userController.logout);
userRouter.get('/config', userController.getConfig);
userRouter.get('/git-credentials', requireAuth, userController.getGitCredentials);


export default userRouter;