'use strict'

const path = require('path')
const CAS = require('simple-cas-interface')
const Hoek = require('hoek')
const Joi = require('joi')
const Boom = require('boom')
const dotProp = require('dot-prop')
let log = require('abstract-logging')

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
 * @property {string} [defaultRedirectUrl] If the user bookmarks the remote
 * CAS server login URL, then a session will not exist to get a redirect
 * path from. Set this to define a default redirect URL in these cases.
 * Default: `localAppUrl` value
 * @property {array} [includeHeaders=['cookie']] The headers to include in
 *  redirections. This list <em>must</em> include the header your session
 *  manager uses for tracking session identifiers.
 * @property {boolean} [strictSSL=true] Determines if the client will require
 *  valid remote SSL certificates or not.
 * @property {boolean} [saveRawCAS=false] If true the CAS result will be
 *  saved into session.rawCas
 * @property {Array} [sessionCredentialsMappings=undefined] An array of objects
 *  where the values of the attribute of <code>request.session</code> listed
 *  in <code>object.sessionAttribute</code> will be mapped to the attribute of
 *  <code>request.auth.credentials</code> listed in
 *  <code>object.credentialsAttribute</code>.  For example, if
 *  <code>sessionCredentialsMappings</code> contains
 *  <code>{sessionAttribute: 'foo.bar', credentialsAttribute: 'baz'}</code>
 *  then <code>request.auth.credentials.baz</code> will contain the same data
 *  as <code>request.session.foo.bar</code>. <strong>NOTE</strong>: dot
 *  notation in the <code>sessionAttribute</code> and
 *  <code>credentialsAttribute</code> attributes is supported.
 * @property {object} [logger=undefined] An instance of a logger that conforms
 *  to the Log4j interface. We recommend {@link https://npm.im/pino}
 */

const optsSchema = Joi.object().keys({
  casServerUrl: Joi.string().uri({scheme: ['http', 'https']}).required(),
  casProtocolVersion: Joi.number().valid([1, 2, 3]).default(2.0),
  casRequestMethod: Joi.string().valid(['GET', 'POST']).default('GET'),
  casAsGateway: Joi.boolean().default(false),
  localAppUrl: Joi.string().uri({scheme: ['http', 'https']}).required(),
  endPointPath: Joi.string().regex(/^\/[\w\W/]+\/?$/).required(),
  defaultRedirectUrl: Joi.string().optional(),
  includeHeaders: Joi.array().items(Joi.string()).default(['cookie']),
  strictSSL: Joi.boolean().default(true),
  saveRawCAS: Joi.boolean().default(false),
  sessionCredentialsMappings: Joi.array().items(Joi.object().keys({
    sessionAttribute: Joi.string(),
    credentialsAttribute: Joi.string()
  }).requiredKeys('sessionAttribute', 'credentialsAttribute')).optional(),
  logger: Joi.object().optional()
})

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
function casPlugin (server, options) {
  Hoek.assert(options, 'Missing CAS auth scheme options')
  const _options = Joi.validate(options, optsSchema)
  Hoek.assert(!_options.error, 'Options object does not pass schema validation: ' + (_options.error ? _options.error.message : ''))
  log = (_options.value.logger)
    ? _options.value.logger.child({module: 'hapi-cas'})
    : log
  log.trace('validated options')

  const casOptions = {
    serverUrl: _options.value.casServerUrl,
    serviceUrl: _options.value.localAppUrl + _options.value.endPointPath,
    protocolVersion: _options.value.casProtocolVersion,
    method: _options.value.casRequestMethod,
    useGateway: _options.value.casAsGateway,
    strictSSL: _options.value.strictSSL,
    logger: log
  }
  const cas = new CAS(casOptions)

  function addHeaders (request, response) {
    if (!response) return response
    // if (!response || !response.header || typeof response.header !== 'function') return response
    for (let h of _options.value.includeHeaders) {
      response.header(h, request.headers[h])
    }
    return response
  }

  async function gethandler (request, h) {
    const ticket = request.query.ticket
    if (!ticket) {
      log.trace('No ticket query parameter supplied to CAS handler end point')
      const boom = Boom.badRequest('Missing ticket parameter')
      return addHeaders(request, h.response(boom))
    }

    return cas.validateServiceTicket(ticket).then(function (result) {
      log.trace('Service ticket validated: %j', result)
      const redirectPath = request.session.requestPath || _options.value.localAppUrl
      request.session.requestPath = undefined
      request.session.isAuthenticated = true
      request.session.username = result.user.toLowerCase()
      request.session.attributes = result.attributes || {}

      // Save raw cas result for processing by client
      if (_options.value.saveRawCAS) {
        request.session.rawCas = result
      }

      return addHeaders(request, h.response(result)).redirect(redirectPath)
    })
      .catch(function caught (error) {
        log.error('Service ticket validation failed: %s', error.message)
        log.debug(error.stack)
        return addHeaders(request, h.response(Boom.forbidden(error.message)))
      })
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
  })

  const scheme = {}
  scheme.authenticate = async function casAuth (request, h) {
    const session = request.session
    if (!session) {
      log.trace('No session provider registered!')
      return Boom.notImplemented('hapi-cas requires a registered Hapi session provider')
    }

    const credentials = {
      username: session.username,
      attributes: session.attributes
    }
    if (_options.value.sessionCredentialsMappings) {
      for (let i = 0; i < _options.value.sessionCredentialsMappings.length; i++) {
        dotProp.set(credentials, _options.value.sessionCredentialsMappings[i].credentialsAttribute, dotProp.get(session, _options.value.sessionCredentialsMappings[i].sessionAttribute))
      }
    }
    log.trace('Credentials: %j', credentials)

    if (session.isAuthenticated) {
      log.trace('User authenticated by session lookup')
      return h.authenticated({credentials})
    }

    log.trace('Redirecting auth to: %s', cas.loginUrl)
    session.requestPath = request.path
    return addHeaders(
      request,
      h.response('cas redirect')
    )
      .redirect(cas.loginUrl).takeover()
  }

  return scheme
}

/**
 * Standard Hapi plugin registration method. It registers {@link casPlugin}
 * with the scheme name 'cas'.
 *
 * @param {object} server A Hapi server instance.
 * @param {object} options A Hapi plugin registration options object.
 * @returns {function} The registration finished callback function.
 */
exports.register = async function (server, options) {
  server.auth.scheme('cas', casPlugin)
}

exports.pkg = require(path.join(__dirname, 'package.json'))
