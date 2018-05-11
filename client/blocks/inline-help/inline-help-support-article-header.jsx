/** @format */
/**
 * External dependencies
 */
import PropTypes from 'prop-types';
import React from 'react';

/**
 * Internal dependencies
 */
import ExternalLink from 'components/external-link';
import ReaderFullPostHeaderPlaceholder from 'blocks/reader-full-post/placeholders/header';

/* eslint-disable react/jsx-no-target-blank */
const ReaderFullPostHeader = ( { post, referralPost, isLoading } ) =>
	isLoading ? (
		<div className="inline-help__article-view__header is-placeholder">
			<h1 className="inline-help__article-view__header-title is-placeholder">Post loading…</h1>
			<div className="inline-help__article-view__header-meta">
				<span className="inline-help__article-view__header-date is-placeholder">Post date</span>
			</div>
		</div>
	) : (
		<div className="inline-help__article-view__header">
			<h1 className="inline-help__article-view__header-title">
				<ExternalLink
					className="inline-help__article-view__header-title-link"
					href={ post.URL }
					target="_blank"
					icon={ false }
				>
					{ post.title }
				</ExternalLink>
			</h1>
		</div>
	);
/* eslint-enable react/jsx-no-target-blank */

ReaderFullPostHeader.propTypes = {
	post: PropTypes.object.isRequired,
	isLoading: PropTypes.bool,
};

export default ReaderFullPostHeader;
