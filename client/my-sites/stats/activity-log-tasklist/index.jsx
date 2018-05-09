/** @format */
/**
 * External dependencies
 */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { localize } from 'i18n-calypso';
import { isEmpty, get, each, omit, union, find } from 'lodash';
import page from 'page';

/**
 * Internal dependencies
 */
import ActivityLogTaskUpdate from './update';
import WithItemsToUpdate from './to-update';
import Card from 'components/card';
import PopoverMenuItem from 'components/popover/menu-item';
import SplitButton from 'components/split-button';
import TrackComponentView from 'lib/analytics/track-component-view';
import PluginNotices from 'lib/plugins/notices';
import { getSite } from 'state/sites/selectors';
import { updatePlugin } from 'state/plugins/installed/actions';
import { getHttpData, requestHttpData } from 'state/data-layer/http-data';
import { http } from 'state/data-layer/wpcom-http/actions';
import { getStatusForPlugin } from 'state/plugins/installed/selectors';
import { errorNotice, infoNotice, successNotice } from 'state/notices/actions';
import { recordTracksEvent, withAnalytics } from 'state/analytics/actions';
import { navigate } from 'state/ui/actions';

/**
 * Checks if the supplied plugin or plugins are currently updating.
 *
 * @param {object|array} s Plugin object or list of plugin objects to check their update status.
 * @returns {bool}         True if one or more plugins are updating.
 */
const isPluginUpdating = s =>
	( Array.isArray( s ) ? s : [ s ] ).some( p => 'inProgress' === get( p, 'updateStatus.status' ) );

/**
 * Checks if the plugin or theme is enqueued to be updated, searching it in the list by its slug.
 *
 * @param {string} g Plugin or theme slug.
 * @param {array}  q Collection of plugins or themes currently in the update queue.
 *
 * @returns {bool}   True if the plugin or theme is enqueued to be updated.
 */
const isItemEnqueued = ( g, q ) => !! find( q, { slug: g } );

class ActivityLogTasklist extends Component {
	static propTypes = {
		siteId: PropTypes.number,
		siteSlug: PropTypes.string,
		plugins: PropTypes.arrayOf( PropTypes.object ), // Plugins updated and those with pending updates
		themes: PropTypes.arrayOf( PropTypes.object ), // Themes to update

		// Connected props
		siteName: PropTypes.string.isRequired,
		trackUpdateAll: PropTypes.func.isRequired,
		goToPage: PropTypes.func.isRequired,

		// Plugins already updated + those with pending updates.
		// This extends plugins with the plugin update status.
		pluginsWithUpdate: PropTypes.arrayOf( PropTypes.object ).isRequired,
		trackUpdatePlugin: PropTypes.func.isRequired,
		trackUpdatePluginFromError: PropTypes.func.isRequired,
		trackDismissPluginAll: PropTypes.func.isRequired,
		trackDismissPlugin: PropTypes.func.isRequired,
		goManagePlugins: PropTypes.func.isRequired,

		// Themes
		updateSingleTheme: PropTypes.func.isRequired,
		themeUpdate: PropTypes.shape( {
			state: PropTypes.oneOf( [ 'uninitialized', 'failure', 'success', 'pending' ] ),
			error: PropTypes.object,
		} ),

		// Localize
		translate: PropTypes.func.isRequired,
		updateSinglePlugin: PropTypes.func.isRequired,
		showErrorNotice: PropTypes.func.isRequired,
		showInfoNotice: PropTypes.func.isRequired,
		showSuccessNotice: PropTypes.func.isRequired,
	};

	state = {
		dismissed: [],
		queued: [],
	};

	/**
	 * Adds a single or multiple plugin slugs to a list of dismissed plugins.
	 * If it receives a string, it assumes it's a valid plugin slug and adds it to the dismissed list.
	 * When it doesn't receive a string, it adds all the plugin slugs to the dismissed list.
	 *
	 * @param {string|void} slug Slug of a plugin or nothing.
	 */
	dismiss = slug => {
		// ToDo: this should update some record in the tasklist API
		const { pluginsWithUpdate, trackDismissPlugin, trackDismissPluginAll } = this.props;
		let plugins;

		if ( 'string' === typeof slug ) {
			plugins = [ slug ];
			trackDismissPlugin( slug );
		} else {
			plugins = pluginsWithUpdate.map( p => p.slug );
			trackDismissPluginAll();
		}

		this.setState( {
			dismissed: union( this.state.dismissed, plugins ),
		} );
	};

	/**
	 * Goes to general plugin management screen.
	 *
	 * @returns {object} Action to redirect to plugins management.
	 */
	goManagePlugins = () => this.props.goManagePlugins( this.props.siteSlug );

	/**
	 * Goes to single theme or plugin management screen.
	 *
	 * @param {string} slug Plugin or theme slug, like "hello-dolly" or "dara".
	 * @param {string} type Indicates if it's "plugins" or "themes".
	 *
	 * @returns {object} Action to redirect to plugin management.
	 */
	goToPage = ( slug, type ) => this.props.goToPage( slug, type, this.props.siteSlug );

	/**
	 * Checks if the plugin update queue has more items and none is currently updating.
	 * If so, updates the next plugin.
	 */
	continueQueue = () => {
		if (
			0 < this.state.queued.length &&
			! isPluginUpdating( Object.values( this.props.pluginsWithUpdate ) )
		) {
			this.updateItem( this.state.queued[ 0 ] );
		}
	};

	/**
	 * Add a plugin to the update queue.
	 *
	 * @param {object} plugin Plugin to enqueue.
	 * @param {string} from   Send 'task' when this is called from the task list, 'notice' when it's called from error notice.
	 */
	enqueue = ( plugin, from = 'task' ) => {
		if ( 'task' === from ) {
			this.props.trackUpdatePlugin( plugin.slug );
		} else if ( 'notice' === from ) {
			this.props.trackUpdatePluginFromError( plugin.slug );
		}
		this.setState(
			{
				queued: union( this.state.queued, [ plugin ] ),
			},
			this.continueQueue
		);
	};

	/**
	 * Remove a plugin from the update queue.
	 *
	 * @returns {undefined}
	 */
	dequeue = () =>
		this.setState(
			{
				queued: this.state.queued.slice( 1 ),
			},
			this.continueQueue
		);

	/**
	 * Add all plugins with pending updates to the queue and process it.
	 */
	updateAll = () => {
		this.props.trackUpdateAll();
		this.setState(
			{
				queued: union( this.state.queued, Object.values( this.props.pluginsWithUpdate ) ),
			},
			this.continueQueue
		);
	};

	/**
	 * Starts the update process for a specified plugin. Displays an informational notice.
	 *
	 * @param {object} plugin Plugin information that includes
	 * {
	 * 		{string} id   Plugin id, like "hello-dolly/hello".
	 * 		{string} slug Plugin slug, like "hello-dolly".
	 * 		{string} name Plugin name, like "Hello Dolly".
	 * }
	 */
	updateItem = item => {
		const {
			showInfoNotice,
			siteName,
			updateSinglePlugin,
			updateSingleTheme,
			translate,
		} = this.props;
		let message;

		if ( 'plugin' === item.type ) {
			updateSinglePlugin( item );
			message = PluginNotices.inProgressMessage( 'UPDATE_PLUGIN', '1 site 1 plugin', {
				plugin: item.name,
				site: siteName,
			} );
		} else {
			updateSingleTheme( item );
			message = translate( 'Updating %(theme)s in %(siteName)s.', {
				args: { theme: item.name, siteName },
			} );
		}
		showInfoNotice( message, {
			id: item.slug,
			showDismiss: false,
		} );
	};

	componentDidMount() {
		const path = `/stats/activity/${ this.props.siteSlug }`;
		page.exit( path, ( context, next ) => {
			if (
				! this.state.queued.length ||
				window.confirm( this.props.translate( 'Navigating away will cancel remaining updates' ) )
			) {
				return next();
			}
			setTimeout(
				() => page.replace( `/stats/activity/${ this.props.siteSlug }`, null, false, false ),
				0
			);
		} );
	}

	componentDidUpdate( prevProps ) {
		if ( isEmpty( this.props.pluginsWithUpdate ) ) {
			return;
		}

		const {
			showErrorNotice,
			showSuccessNotice,
			siteName,
			translate,
			pluginsWithUpdate,
		} = this.props;

		each( pluginsWithUpdate, plugin => {
			const pluginSlug = plugin.slug;
			const prevPluginWithUpdate = find( prevProps.pluginsWithUpdate, { slug: pluginSlug } );

			if ( false === get( prevPluginWithUpdate, [ 'updateStatus' ], false ) ) {
				return;
			}

			if (
				get( prevPluginWithUpdate, [ 'updateStatus', 'status' ], false ) ===
					get( plugin.updateStatus, 'status', false ) ||
				isPluginUpdating( plugin )
			) {
				return;
			}

			const updateStatus = plugin.updateStatus;

			// If it errored, show error notice
			const pluginData = {
				plugin: plugin.name,
				site: siteName,
			};

			switch ( updateStatus.status ) {
				case 'error':
					showErrorNotice(
						PluginNotices.singleErrorMessage( 'UPDATE_PLUGIN', pluginData, {
							error: updateStatus,
						} ),
						{
							id: pluginSlug,
							button: translate( 'Try again' ),
							onClick: () => this.enqueue( plugin, 'notice' ),
						}
					);
					this.dequeue();
					break;
				case 'completed':
					showSuccessNotice(
						PluginNotices.successMessage( 'UPDATE_PLUGIN', '1 site 1 plugin', pluginData ),
						{
							id: pluginSlug,
							duration: 3000,
						}
					);
					this.dismiss( pluginSlug );
					this.dequeue();
					break;
			}
		} );
	}

	render() {
		const itemsToUpdate = union(
			Object.values( omit( this.props.pluginsWithUpdate, this.state.dismissed ) ),
			Object.values( omit( this.props.themes, this.state.dismissed ) )
		);
		if ( isEmpty( itemsToUpdate ) ) {
			return null;
		}

		const { translate } = this.props;
		const numberOfUpdates = itemsToUpdate.length;
		const queued = this.state.queued;

		return (
			<Card className="activity-log-tasklist" highlight="warning">
				<TrackComponentView eventName={ 'calypso_activitylog_tasklist_update_impression' } />
				<div className="activity-log-tasklist__heading">
					{ // Not using count method since we want a "one" string.
					1 < numberOfUpdates
						? translate(
								'You have %(updates)s update available',
								'You have %(updates)s updates available',
								{
									count: numberOfUpdates,
									args: { updates: numberOfUpdates },
								}
							)
						: translate( 'You have one update available' ) }
					{ 1 < numberOfUpdates && (
						<SplitButton
							compact
							primary
							label={ translate( 'Update all' ) }
							onClick={ this.updateAll }
							disabled={ 0 < queued.length }
						>
							<PopoverMenuItem
								onClick={ this.goManagePlugins }
								className="activity-log-tasklist__menu-item"
								icon="cog"
							>
								<span>{ translate( 'Manage plugins' ) }</span>
							</PopoverMenuItem>
							<PopoverMenuItem
								onClick={ this.dismiss }
								className="activity-log-tasklist__menu-item"
								icon="trash"
							>
								<span>{ translate( 'Dismiss all' ) }</span>
							</PopoverMenuItem>
						</SplitButton>
					) }
				</div>
				{ // Show if plugin update didn't start, is still running or errored,
				// but hide plugin if it was updated successfully.
				itemsToUpdate.map( item => (
					<ActivityLogTaskUpdate
						key={ item.slug }
						toUpdate={ item }
						name={ item.name }
						slug={ item.slug }
						version={ item.version }
						type={ item.type }
						updateType={
							'plugin' === item.type
								? translate( 'Plugin update available' )
								: translate( 'Theme update available' )
						}
						goToPage={ this.goToPage }
						enqueue={ this.enqueue }
						dismiss={ this.dismiss }
						disable={ isItemEnqueued( item.slug, queued ) }
					/>
				) ) }
			</Card>
		);
	}
}

/**
 * Creates an object, keyed by plugin slug, of objects containing plugin information
 * {
 * 		{string}       id     Plugin directory and base file name without extension
 * 		{string}       slug   Plugin directory
 * 		{string}       name   Plugin name
 * 		{object|false} status Current update status
 * }
 * @param {array}  pluginList Collection of plugins that will be updated.
 * @param {object} state      App state tree.
 * @param {number} siteId     ID of the site where the plugin is installed.
 *
 * @returns {array} List of plugins to update with their status.
 */
const makePluginsList = ( pluginList, state, siteId ) =>
	pluginList.map( plugin => ( {
		...plugin,
		updateStatus: getStatusForPlugin( state, siteId, plugin.id ),
	} ) );

/**
 * Start updating the theme in the specified site.
 *
 * @param {number} siteId  Site Id.
 * @param {string} themeId Theme slug.
 *
 * @return {*} Stored data container for request.
 */
const updateTheme = ( siteId, themeId ) =>
	requestHttpData(
		`theme-update-${ siteId }-${ themeId }`,
		http( {
			method: 'POST',
			path: `/sites/${ siteId }/themes`,
			body: { action: 'update', themes: themeId },
		} ),
		{ fromApi: () => ( { themes: { id } } ) => [ [ id, true ] ] }
	);

const mapStateToProps = ( state, { siteId, plugins } ) => {
	const site = getSite( state, siteId );
	return {
		siteId,
		siteSlug: site.slug,
		siteName: site.name,
		pluginsWithUpdate: makePluginsList( plugins, state, siteId ),
		themeUpdate: getHttpData( `theme-update-${ siteId }-dara-wpcom` ),
	};
};

const mapDispatchToProps = ( dispatch, { siteId } ) => ( {
	updateSinglePlugin: plugin => dispatch( updatePlugin( siteId, plugin ) ),
	updateSingleTheme: theme => updateTheme( siteId, theme.slug ),
	showErrorNotice: ( error, options ) => dispatch( errorNotice( error, options ) ),
	showInfoNotice: ( info, options ) => dispatch( infoNotice( info, options ) ),
	showSuccessNotice: ( success, options ) => dispatch( successNotice( success, options ) ),
	trackUpdatePlugin: plugin_slug =>
		dispatch( recordTracksEvent( 'calypso_activitylog_tasklist_update_plugin', { plugin_slug } ) ),
	trackUpdatePluginFromError: plugin_slug =>
		dispatch(
			recordTracksEvent( 'calypso_activitylog_tasklist_update_plugin_from_error', { plugin_slug } )
		),
	trackUpdateAll: () =>
		dispatch( recordTracksEvent( 'calypso_activitylog_tasklist_update_plugin_all' ) ),
	trackDismissPluginAll: () =>
		dispatch( recordTracksEvent( 'calypso_activitylog_tasklist_dismiss_plugin_all' ) ),
	trackDismissPlugin: plugin_slug =>
		dispatch( recordTracksEvent( 'calypso_activitylog_tasklist_dismiss_plugin', { plugin_slug } ) ),
	goManagePlugins: siteSlug =>
		dispatch(
			withAnalytics(
				recordTracksEvent( 'calypso_activitylog_tasklist_manage_plugins' ),
				navigate( `/plugins/manage/${ siteSlug }` )
			)
		),
	goToPage: ( slug, type, siteSlug ) =>
		dispatch(
			'plugins' === type
				? withAnalytics(
						recordTracksEvent( 'calypso_activitylog_tasklist_manage_single_plugin' ),
						navigate( `/plugins/${ slug }/${ siteSlug }` )
					)
				: withAnalytics(
						recordTracksEvent( 'calypso_activitylog_tasklist_manage_single_theme' ),
						navigate( `/themes/${ slug }/${ siteSlug }` )
					)
		),
} );

export default WithItemsToUpdate(
	connect( mapStateToProps, mapDispatchToProps )( localize( ActivityLogTasklist ) )
);
