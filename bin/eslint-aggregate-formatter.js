/** @format */

const path = require( 'path' );

module.exports = function( results ) {
	let totalErrors = 0;
	const errorsPerRule = results.reduce( ( agg, current ) => {
		current.messages.forEach( msg => {
			agg.set( msg.ruleId, 1 + ( agg.get( msg.ruleId ) || 0 ) );
			totalErrors++;
		} );
		return agg;
	}, new Map() );

	const pairs = Array.from( errorsPerRule );
	pairs.sort( ( a, b ) => {
		const countDiff = b[ 1 ] - a[ 1 ];
		if ( countDiff !== 0 ) {
			return countDiff;
		}
		return a[ 0 ].localeCompare( b[ 0 ] );
	} );

	pairs.forEach( pair => {
		console.log( pair.join( ': ' ) );
	} );

	console.log( '\ntotal: ' + totalErrors );
};
