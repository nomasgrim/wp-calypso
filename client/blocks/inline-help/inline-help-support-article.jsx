/** @format */
/**
 * External Dependencies
 */
import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';
import { get, startsWith } from 'lodash';

/**
 * Internal Dependencies
 */
import AutoDirection from 'components/auto-direction';
import ReaderMain from 'components/reader-main';
import EmbedContainer from 'components/embed-container';
import PostExcerpt from 'components/post-excerpt';
import { markPostSeen } from 'state/reader/posts/actions';
import SupportArticleHeader from 'blocks/inline-help/inline-help-support-article-header';


import CommentButton from 'blocks/comment-button';
import {
	recordAction,
	recordGaEvent,
	recordTrackForPost,
	recordPermalinkClick,
} from 'reader/stats';
import { getSiteName } from 'reader/get-helpers';
import KeyboardShortcuts from 'lib/keyboard-shortcuts';
import ReaderPostActions from 'blocks/reader-post-actions';
import { RelatedPostsFromSameSite, RelatedPostsFromOtherSites } from 'components/related-posts';
import { getStreamUrlFromPost } from 'reader/route';
import { like as likePost, unlike as unlikePost } from 'state/posts/likes/actions';
import FeaturedImage from 'blocks/reader-full-post/featured-image';
import { getFeed } from 'state/reader/feeds/selectors';
import { getSite } from 'state/reader/sites/selectors';
import QueryReaderSite from 'components/data/query-reader-site';
import QueryReaderFeed from 'components/data/query-reader-feed';
import QueryReaderPost from 'components/data/query-reader-post';
import ExternalLink from 'components/external-link';
import DocumentHead from 'components/data/document-head';
import ReaderFullPostUnavailable from 'blocks/reader-full-post/unavailable';
import { isFeaturedImageInContent } from 'lib/post-normalizer/utils';
import ReaderFullPostContentPlaceholder from 'blocks/reader-full-post/placeholders/content';
import * as FeedStreamStoreActions from 'lib/feed-stream-store/actions';
import { getLastStore } from 'reader/controller-helper';
import { showSelectedPost } from 'reader/utils';
import Emojify from 'components/emojify';
import config from 'config';
import { COMMENTS_FILTER_ALL } from 'blocks/comments/comments-filters';
import { READER_FULL_POST } from 'reader/follow-sources';
import { getPostByKey } from 'state/reader/posts/selectors';
import isLikedPost from 'state/selectors/is-liked-post';
import QueryPostLikes from 'components/data/query-post-likes';

export class FullPostView extends React.Component {
	static propTypes = {
		post: PropTypes.object,
		onClose: PropTypes.func.isRequired,
		referralPost: PropTypes.object,
		referralStream: PropTypes.string,
	};

	hasScrolledToCommentAnchor = false;

	componentDidMount() {
		KeyboardShortcuts.on( 'close-full-post', this.handleBack );
		KeyboardShortcuts.on( 'like-selection', this.handleLike );
		KeyboardShortcuts.on( 'move-selection-down', this.goToNextPost );
		KeyboardShortcuts.on( 'move-selection-up', this.goToPreviousPost );

		// Send page view
		this.hasSentPageView = false;
		this.hasLoaded = false;
		this.attemptToSendPageView();

		this.checkForCommentAnchor();

		// If we have a comment anchor, scroll to comments
		// if ( this.hasCommentAnchor && ! this.hasScrolledToCommentAnchor ) {
		// 	this.scrollToComments();
		// }
	}

	componentDidUpdate( prevProps ) {
		// Send page view if applicable
		if (
			get( prevProps, 'post.ID' ) !== get( this.props, 'post.ID' ) ||
			get( prevProps, 'feed.ID' ) !== get( this.props, 'feed.ID' ) ||
			get( prevProps, 'site.ID' ) !== get( this.props, 'site.ID' )
		) {
			// this.hasSentPageView = false;
			// this.hasLoaded = false;
			// this.attemptToSendPageView();
		}

		this.checkForCommentAnchor();

		// If we have a comment anchor, scroll to comments
		// if ( this.hasCommentAnchor && ! this.hasScrolledToCommentAnchor ) {
		// 	this.scrollToComments();
		// }
	}

	componentWillReceiveProps( newProps ) {
		if ( newProps.shouldShowComments ) {
			this.hasScrolledToCommentAnchor = false;
			this.checkForCommentAnchor();
		}
	}

	componentWillUnmount() {
		KeyboardShortcuts.off( 'close-full-post', this.handleBack );
		KeyboardShortcuts.off( 'like-selection', this.handleLike );
		KeyboardShortcuts.off( 'move-selection-down', this.goToNextPost );
		KeyboardShortcuts.off( 'move-selection-up', this.goToPreviousPost );
	}

	handleBack = event => {
		event.preventDefault();
		recordAction( 'full_post_close' );
		recordGaEvent( 'Closed Full Post Dialog' );
		recordTrackForPost( 'calypso_reader_article_closed', this.props.post );

		this.props.onClose && this.props.onClose();
	};

	handleCommentClick = () => {
		recordAction( 'click_comments' );
		recordGaEvent( 'Clicked Post Comment Button' );
		recordTrackForPost( 'calypso_reader_full_post_comments_button_clicked', this.props.post );
		// this.scrollToComments();
	};

	handleLike = () => {
		// cannot like posts backed by rss feeds
		if ( ! this.props.post || this.props.post.is_external ) {
			return;
		}

		const { site_ID: siteId, ID: postId } = this.props.post;
		let liked = this.props.liked;

		if ( liked ) {
			this.props.unlikePost( siteId, postId, { source: 'reader' } );
			liked = false;
		} else {
			this.props.likePost( siteId, postId, { source: 'reader' } );
			liked = true;
		}

		recordAction( liked ? 'liked_post' : 'unliked_post' );
		recordGaEvent( liked ? 'Clicked Like Post' : 'Clicked Unlike Post' );
		recordTrackForPost(
			liked ? 'calypso_reader_article_liked' : 'calypso_reader_article_unliked',
			this.props.post,
			{ context: 'full-post', event_source: 'keyboard' }
		);
	};

	handleRelatedPostFromSameSiteClicked = () => {
		// recordTrackForPost( 'calypso_reader_related_post_from_same_site_clicked', this.props.post );
	};

	handleVisitSiteClick = () => {
		// recordPermalinkClick( 'full_post_visit_link', this.props.post );
	};

	handleRelatedPostFromOtherSiteClicked = () => {
		// recordTrackForPost( 'calypso_reader_related_post_from_other_site_clicked', this.props.post );
	};

	// Does the URL contain the anchor #comments? If so, scroll to comments if we're not already there.
	checkForCommentAnchor = () => {
		const hash = window.location.hash.substr( 1 );
		if ( hash.indexOf( 'comments' ) > -1 ) {
			this.hasCommentAnchor = true;
		}
	};

	/**
	 * @returns {number} - the commentId in the url of the form #comment-${id}
	 */
	getCommentIdFromUrl = () =>
		startsWith( window.location.hash, '#comment-' )
			? +window.location.hash.split( '-' )[ 1 ]
			: undefined;

	// Scroll to the top of the comments section.
	scrollToComments = () => {};

	attemptToSendPageView = () => {
		const { post, site } = this.props;

		if (
			post &&
			post._state !== 'pending' &&
			site &&
			site.ID &&
			! site.is_error &&
			! this.hasSentPageView
		) {
			this.props.markPostSeen( post, site );
			this.hasSentPageView = true;
		}

		if ( ! this.hasLoaded && post && post._state !== 'pending' ) {
			recordTrackForPost(
				'calypso_reader_article_opened',
				post,
				{},
				{
					pathnameOverride: this.props.referralStream,
				}
			);
			this.hasLoaded = true;
		}
	};

	goToNextPost = () => {};

	goToPreviousPost = () => {};

	render() {
		const { post, site, feed, referralPost, referral, blogId, feedId, postId } = this.props;

		if ( post.is_error ) {
			return <ReaderFullPostUnavailable post={ post } onBackClick={ this.handleBack } />;
		}

		const siteName = getSiteName( { site, post } );
		const classes = { 'inline-help__article-view': true };

		if ( post.site_ID ) {
			classes[ 'blog-' + post.site_ID ] = true;
		}
		if ( post.feed_ID ) {
			classes[ 'feed-' + post.feed_ID ] = true;
		}

		const externalHref = post.URL;
		const isLoading = ! post || post._state === 'pending' || post._state === 'minimal';
		const commentCount = get( post, 'discussion.comment_count' );
		const postKey = { blogId, feedId, postId };

		/*eslint-disable react/no-danger */
		/*eslint-disable react/jsx-no-target-blank */
		return (
			<ReaderMain className={ classNames( classes ) }>
				{ site && <QueryPostLikes siteId={ post.site_ID } postId={ post.ID } /> }
				{ post && post.feed_ID && <QueryReaderFeed feedId={ +post.feed_ID } /> }
				{ post &&
					! post.is_external &&
					post.site_ID && <QueryReaderSite siteId={ +post.site_ID } /> }
				{ referral && ! referralPost && <QueryReaderPost postKey={ referral } /> }
				{ ! post || ( isLoading && <QueryReaderPost postKey={ postKey } /> ) }
				<div className="inline-help__article-view__content">
					<Emojify>
						<article className="inline-help__article-view__story" ref="article">
							<SupportArticleHeader
								post={ post }
								referralPost={ referralPost }
								isLoading={ ! post || isLoading }
							/>

							{ post.featured_image &&
								! isFeaturedImageInContent( post ) && (
									<FeaturedImage src={ post.featured_image } />
								) }
							{
								isLoading && (
									<React.Fragment>
										<div className="inline-help__article-view__story-content is-placeholder">
											<p className="inline-help__article-view__story-content-placeholder-text" />
											<p className="inline-help__article-view__story-content-placeholder-text" />
										</div>
										<div className="inline-help__article-view__story-content is-placeholder">
											<p className="inline-help__article-view__story-content-placeholder-text" />
											<p className="inline-help__article-view__story-content-placeholder-text" />
										</div>
										<div className="inline-help__article-view__story-content is-placeholder">
											<p className="inline-help__article-view__story-content-placeholder-text" />
											<p className="inline-help__article-view__story-content-placeholder-text" />
										</div>
										<div className="inline-help__article-view__story-content is-placeholder">
											<p className="inline-help__article-view__story-content-placeholder-text" />
											<p className="inline-help__article-view__story-content-placeholder-text" />
										</div>
									</React.Fragment>
								)
							}
							{ post.use_excerpt ? (
								<PostExcerpt content={ post.better_excerpt ? post.better_excerpt : post.excerpt } />
							) : (
								<EmbedContainer>
									<AutoDirection>
										<div
											className="inline-help__article-view__story-content"
											dangerouslySetInnerHTML={ { __html: post.content } }
										/>
									</AutoDirection>
								</EmbedContainer>
							) }

							<ReaderPostActions
								post={ post }
								site={ site }
								onCommentClick={ this.handleCommentClick }
								fullPost={ true }
							/>
						</article>
					</Emojify>
				</div>
			</ReaderMain>
		);
	}
}


export default connect(
	( state, ownProps ) => {
		const { feedId, blogId, postId } = ownProps;
		const post = getPostByKey( state, { feedId, blogId, postId } ) || { _state: 'pending' };

		const { site_ID: siteId, is_external: isExternal } = post;

		const props = {
			post,
			liked: isLikedPost( state, siteId, post.ID ),
		};

		if ( ! isExternal && siteId ) {
			props.site = getSite( state, siteId );
		}
		if ( feedId ) {
			props.feed = getFeed( state, feedId );
		}
		if ( ownProps.referral ) {
			props.referralPost = getPostByKey( state, ownProps.referral );
		}

		return props;
	},
	{ markPostSeen, likePost, unlikePost }
)( FullPostView );
