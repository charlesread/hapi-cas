'use strict';

const debug = require('debug')('hapi-cas:main');
const CAS = require('@jsumners/simple-cas-client');
const Hoek = require('hoek');
const Joi = require('joi');
const Boom = require('boom');

/**
 * <p>Defines the possible options for the plugin.</p>
 *
 * @typedef {object} PluginOptions
 * @property {string} casServerUrl The URL for the remote CAS server. It
 *  <em>should</em> be an HTTPS URL. But it <em>can</em> be HTTP if the remote
 *  server isn't fully protocol compliant.
 *  Example: <tt>https://example.com/cas/</tt>
 * @property {number} [casProtocolVersion=2.0] The version of the CAS protocol
 *  that the remote server implements.
 * @property {string} [casRequestMethod=GET] The HTTP method that the remote
 *  CAS server should use to communicate with the local CAS handler end point.
 *  <strong>NOTE:</strong> only <em>GET</em> is currently supported.
 * @property {boolean} [casAsGateway=false] Indicates if the remote CAS server
 *  should use its gateway method of operation.
 * @property {string} localAppUrl The base URL for your local applications. It
 *  <em>should</em> be an HTTPS URL. But it <em>can</em> be HTTP if the remote
 *  server isn't fully protocol compliant.
 *  Example: <tt>https://app.example.com/</tt>
 * @property {string} endPointPath The URI path where your application will
 *  listen for incoming CAS protocol messages. Example: <tt>/casHandler</tt>
 * @property {array} [includeHeaders=['cookie']] The headers to include in
 *  redirections. This list <em>must</em> include the header your session
 *  manager uses for tracking session identifiers.
 */

const optsSchema = Joi.object().keys({
  casServerUrl: Joi.string().uri({sheme: ['http', 'https']}).required(),
  casProtocolVersion: Joi.number().valid([1,2,3]).default(2.0),
  casRequestMethod: Joi.string().valid(['GET', 'POST']).default('GET'),
  casAsGateway: Joi.boolean().default(false),
  localAppUrl: Joi.string().uri({scheme: ['http', 'https']}).required(),
  endPointPath: Joi.string().regex(/^\/[\w\W\/]+\/?$/).required(),
  includeHeaders: Joi.array().items(Joi.string()).default(['cookie'])
});

/**
 * <p>Provides an authentication plugin for the Hapi framework that implements
 * CAS authentication. Due to the nature of the CAS protocol, this plugin
 * requires that a session manager plugin be registered with Hapi. This plugin
 * does not provide a session manager on its own. The 'hapi-server-session'
 * plugin is known to work. But any plugin that provides
 * <tt>request.session</tt> will work.</p>
 *
 * <p>This plugin is known to work with authentication modes 'required' and
 * 'try'.</p>
 *
 * @param {object} server A Hapi server instance.
 * @param {PluginOptions} options The options for the CAS authentication plugin.
 * @returns {object} A Hapi authentication scheme object.
 * @throws {AssertionError} When an invalid options object is provided or if
 *  there isn't a session manager registered with the Hapi server.
 */
function casPlugin(server, options) {
  Hoek.assert(options, 'Missing CAS auth scheme options');
  const _options = Joi.validate(options, optsSchema);
  Hoek.assert(_options, 'Options object does not pass schema validation');
  debug('validated options: %j', _options.value);

  const casOptions = {
    serverUrl: _options.value.casServerUrl,
    serviceUrl: _options.value.localAppUrl + _options.value.endPointPath,
    protocolVersion: _options.value.casProtocolVersion,
    method: _options.value.casRequestMethod,
    useGateway: _options.value.casAsGateway
  };
  const cas = new CAS(casOptions);

  function addHeaders(request, response) {
    for (let h of _options.value.includeHeaders) {
      response.header(h, request.headers[h]);
    }
    return response;
  }

  function gethandler(request, reply) {
    const ticket = request.query.ticket;
    if (!ticket) {
      debug('No ticket query parameter supplied to CAS handler end point');
      const boom = Boom.badRequest('Missing ticket parameter');
      return addHeaders(request, reply(boom));
    }

    const response = reply(
      cas.validateServiceTicket(ticket).then(function (result) {
        debug('Service ticket validated:');
        debug('%j', result);
        const redirectPath = request.session.requestPath;
        delete request.session.requestPath;
        request.session.isAuthenticated = true;
        request.session.username = result.user;
        request.session.attributes = result.attributes || {};

        return response.redirect(redirectPath);
      })
      .catch(function caught(error) {
        debug('Service ticket validation failed:');
        debug('%j', error);
        return Boom.forbidden(error.message);
      })
    );

    return addHeaders(request, response);
  }

  server.route({
    method: 'GET',
    path: options.endPointPath,
    handler: gethandler,
    config: {
      auth: false,
      cache: {
        privacy: 'private',
        expiresIn: 0
      }
    }
  });

  const scheme = {};
  scheme.authenticate = function casAuth(request, reply) {
    const session = request.session;
    if (!session) {
      debug('No session provider registered!');
      return reply(Boom.notImplemented(
        'hapi-cas requires a registered Hapi session provider'
      ));
    }

    const credentials = {
      username: session.username,
      attributes: session.attributes
    };
    debug('Credentials: %j', credentials);

    if (session.isAuthenticated) {
      debug('User authenticated by session lookup');
      return reply.continue({credentials: credentials});
    }

    debug('Redirecting auth to: %s', cas.loginUrl);
    session.requestPath = request.path;
    return addHeaders(
      request,
      reply('cas redirect', null, {credentials: credentials})
    )
    .redirect(cas.loginUrl);
  };

  return scheme;
}

/**
 * Standard Hapi plugin registration method. It registers {@link casPlugin}
 * with the scheme name 'cas'.
 *
 * @param {object} server A Hapi server instance.
 * @param {object} options A Hapi plugin registration options object.
 * @param {function} next The Hapi registration finished callback function.
 * @returns {function} The registration finished callback function.
 */
exports.register = function (server, options, next) {
  server.auth.scheme('cas', casPlugin);
  return next();
};

module.exports.register.attributes = {
    pkg: require(__dirname + '/package.json')
};