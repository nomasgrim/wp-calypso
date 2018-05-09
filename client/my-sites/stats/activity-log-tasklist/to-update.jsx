/** @format */

/**
 * External dependencies
 */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { unionBy, extend } from 'lodash';

/**
 * Internal dependencies
 */
import { getPluginsWithUpdates } from 'state/plugins/installed/selectors';

// Fake data while the API is built
const getThemesWithUpdates = () => [
	{
		name: 'Dara',
		slug: 'dara-wpcom',
		version: '1.7',
		type: 'theme',
	},
	{
		name: 'TwentyFourteen',
		slug: 'twentyfourteen',
		version: '2.1',
		type: 'theme',
	},
];

const mapUpdateNewVersionToVersion = plugin =>
	extend( plugin, {
		version: plugin.update.new_version,
		type: 'plugin',
	} );

export default WrappedComponent => {
	class ToUpdate extends Component {
		static propTypes = {
			siteId: PropTypes.number,

			// Connected
			plugins: PropTypes.arrayOf( PropTypes.object ),
			themes: PropTypes.arrayOf( PropTypes.object ),
		};

		state = {
			// Plugins already updated + those with pending updates
			plugins: [],
		};

		static getDerivedStateFromProps( nextProps, prevState ) {
			return {
				plugins: unionBy( nextProps.plugins, prevState.plugins, 'slug' ),
			};
		}

		render() {
			return (
				<WrappedComponent
					{ ...this.props }
					siteId={ this.props.siteId }
					plugins={ this.state.plugins }
					themes={ this.props.themes }
				/>
			);
		}
	}
	return connect( ( state, { siteId } ) => ( {
		plugins: getPluginsWithUpdates( state, [ siteId ] ).map( mapUpdateNewVersionToVersion ),
		themes: getThemesWithUpdates(),
	} ) )( ToUpdate );
};
