/** @format */

/**
 * External dependencies
 */
import classNames from 'classnames';
import { connect } from 'react-redux';
import { localize } from 'i18n-calypso';
import page from 'page';
import PropTypes from 'prop-types';
import React, { Component, Fragment } from 'react';

/**
 * Internal Dependencies
 */
import { abtest } from 'lib/abtest';
import analytics from 'lib/analytics';
import { applyTestFiltersToPlansList } from 'lib/plans';
import Button from 'components/button';
import Card from 'components/card';
import { cartItems } from 'lib/cart-values';
import CompactCard from 'components/card/compact';
import config from 'config';
import {
	getName,
	hasPrivacyProtection,
	isCancelable,
	isExpired,
	isExpiring,
	isOneTimePurchase,
	isPaidWithCreditCard,
	isRefundable,
	isRenewable,
	isRenewal,
	isRenewing,
	isSubscription,
	purchaseType,
	cardProcessorSupportsUpdates,
} from 'lib/purchases';
import {
	canEditPaymentDetails,
	isDataLoading,
	getEditCardDetailsPath,
	getPurchase,
	recordPageView,
} from '../utils';
import { getByPurchaseId, hasLoadedUserPurchasesFromServer } from 'state/purchases/selectors';
import { getCanonicalTheme } from 'state/themes/selectors';
import { isSiteAutomatedTransfer as isSiteAtomic } from 'state/selectors';
import Gridicon from 'gridicons';
import HeaderCake from 'components/header-cake';
import {
	isPersonal,
	isPremium,
	isBusiness,
	isPlan,
	isDomainProduct,
	isDomainRegistration,
	isDomainMapping,
	isDomainTransfer,
	isTheme,
} from 'lib/products-values';
import { getSite, isRequestingSites } from 'state/sites/selectors';
import Main from 'components/main';
import PlanIcon from 'components/plans/plan-icon';
import PlanPrice from 'my-sites/plan-price';
import ProductLink from 'me/purchases/product-link';
import PurchaseMeta from './purchase-meta';
import PurchaseNotice from './notices';
import PurchasePlanDetails from './plan-details';
import PurchaseSiteHeader from '../purchases-site/header';
import QueryCanonicalTheme from 'components/data/query-canonical-theme';
import QueryUserPurchases from 'components/data/query-user-purchases';
import RemovePurchase from '../remove-purchase';
import VerticalNavItem from 'components/vertical-nav/item';
import { cancelPurchase, cancelPrivacyProtection, purchasesRoot } from '../paths';
import { CALYPSO_CONTACT } from 'lib/url/support';
import titles from 'me/purchases/titles';
import { addItems } from 'lib/upgrades/actions';
import PageViewTracker from 'lib/analytics/page-view-tracker';
import { getCurrentUserId } from 'state/current-user/selectors';

class ManagePurchase extends Component {
	static propTypes = {
		destinationType: PropTypes.string,
		hasLoadedSites: PropTypes.bool.isRequired,
		hasLoadedUserPurchasesFromServer: PropTypes.bool.isRequired,
		isAtomicSite: PropTypes.bool,
		isPurchaseTheme: PropTypes.bool,
		plan: PropTypes.object,
		selectedPurchase: PropTypes.object,
		selectedSite: PropTypes.object,
		siteId: PropTypes.number,
		siteSlug: PropTypes.string.isRequired,
		theme: PropTypes.object,
		userId: PropTypes.number.isRequired,
	};

	componentWillMount() {
		if ( ! this.isDataValid() ) {
			page.redirect( purchasesRoot );
			return;
		}

		recordPageView( 'manage', this.props );
	}

	componentWillReceiveProps( nextProps ) {
		if ( this.isDataValid() && ! this.isDataValid( nextProps ) ) {
			page.redirect( purchasesRoot );
			return;
		}

		recordPageView( 'manage', this.props, nextProps );
	}

	isDataValid( props = this.props ) {
		if ( isDataLoading( props ) ) {
			return true;
		}

		return Boolean( getPurchase( props ) );
	}

	handleRenew = () => {
		const purchase = getPurchase( this.props ),
			renewItem = cartItems.getRenewalItemFromProduct( purchase, {
				domain: purchase.meta,
			} ),
			renewItems = [ renewItem ];

		// Track the renew now submit
		analytics.tracks.recordEvent( 'calypso_purchases_renew_now_click', {
			product_slug: purchase.productSlug,
		} );

		if ( hasPrivacyProtection( purchase ) ) {
			const privacyItem = cartItems.getRenewalItemFromCartItem(
				cartItems.domainPrivacyProtection( {
					domain: purchase.meta,
				} ),
				{
					id: purchase.id,
					domain: purchase.domain,
				}
			);

			renewItems.push( privacyItem );
		}

		addItems( renewItems );

		page( '/checkout/' + this.props.siteSlug );
	};

	renderRenewButton() {
		const purchase = getPurchase( this.props );
		const { translate } = this.props;

		if ( ! config.isEnabled( 'upgrades/checkout' ) ) {
			return null;
		}

		if (
			! isRenewable( purchase ) ||
			isExpired( purchase ) ||
			isExpiring( purchase ) ||
			! this.props.selectedSite
		) {
			return null;
		}

		return (
			<Button className="manage-purchase__renew-button" onClick={ this.handleRenew } compact>
				{ translate( 'Renew Now' ) }
			</Button>
		);
	}

	renderPlanDetails() {
		return (
			<PurchasePlanDetails
				selectedSite={ this.props.selectedSite }
				purchaseId={ this.props.purchaseId }
			/>
		);
	}

	renderEditPaymentMethodNavItem() {
		const purchase = getPurchase( this.props );
		const { translate } = this.props;

		if ( ! this.props.selectedSite ) {
			return null;
		}

		if ( canEditPaymentDetails( purchase ) ) {
			const path = getEditCardDetailsPath( this.props.selectedSite.slug, purchase );
			const renewing = isRenewing( purchase );

			if (
				renewing &&
				isPaidWithCreditCard( purchase ) &&
				! cardProcessorSupportsUpdates( purchase )
			) {
				return null;
			}

			const text = renewing ? translate( 'Edit Payment Method' ) : translate( 'Add Credit Card' );

			return <CompactCard href={ path }>{ text }</CompactCard>;
		}

		return null;
	}

	renderCancelPurchaseNavItem() {
		const purchase = getPurchase( this.props ),
			{ id } = purchase;
		const { translate, isAtomicSite } = this.props;

		if ( ! isCancelable( purchase ) || ! this.props.selectedSite ) {
			return null;
		}

		const trackNavItemClick = linkText => () => {
			analytics.tracks.recordEvent( 'calypso_purchases_manage_purchase_cancel_click', {
				product_slug: purchase.productSlug,
				is_atomic: isAtomicSite,
				link_text: linkText,
			} );
		};

		let text,
			link = cancelPurchase( this.props.siteSlug, id );

		if ( isAtomicSite && isSubscription( purchase ) ) {
			text = translate( 'Contact Support to Cancel your Subscription' );
			link = CALYPSO_CONTACT;
		} else if ( isRefundable( purchase ) ) {
			if ( isDomainRegistration( purchase ) ) {
				if ( isRenewal( purchase ) ) {
					text = translate( 'Contact Support to Cancel Domain and Refund' );
					link = CALYPSO_CONTACT;
				} else {
					text = translate( 'Cancel Domain and Refund' );
				}
			}

			if ( isSubscription( purchase ) ) {
				text = translate( 'Cancel Subscription and Refund' );
			}

			if ( isOneTimePurchase( purchase ) ) {
				text = translate( 'Cancel and Refund' );
			}
		} else {
			if ( isDomainTransfer( purchase ) ) {
				return null;
			}

			if ( isDomainRegistration( purchase ) ) {
				text = translate( 'Cancel Domain' );
			}

			if ( isSubscription( purchase ) ) {
				text = translate( 'Cancel Subscription' );
			}
		}

		return (
			<CompactCard href={ link } onClick={ trackNavItemClick( text ) }>
				{ text }
			</CompactCard>
		);
	}

	renderCancelPrivacyProtection() {
		const purchase = getPurchase( this.props ),
			{ id } = purchase;
		const { translate } = this.props;

		if (
			isExpired( purchase ) ||
			! hasPrivacyProtection( purchase ) ||
			! this.props.selectedSite
		) {
			return null;
		}

		return (
			<CompactCard href={ cancelPrivacyProtection( this.props.siteSlug, id ) }>
				{ translate( 'Cancel Privacy Protection' ) }
			</CompactCard>
		);
	}

	renderPlanIcon() {
		const purchase = getPurchase( this.props );
		if ( isPlan( purchase ) ) {
			return (
				<div className="manage-purchase__plan-icon">
					<PlanIcon plan={ purchase.productSlug } />
				</div>
			);
		}

		if ( isDomainProduct( purchase ) || isDomainTransfer( purchase ) ) {
			return (
				<div className="manage-purchase__plan-icon">
					<Gridicon icon="domains" size={ 54 } />
				</div>
			);
		}

		if ( isTheme( purchase ) ) {
			return (
				<div className="manage-purchase__plan-icon">
					<Gridicon icon="themes" size={ 54 } />
				</div>
			);
		}

		return null;
	}

	renderPlanDescription() {
		const purchase = getPurchase( this.props );
		const { plan, selectedSite, theme, translate } = this.props;

		let description = purchaseType( purchase );
		if ( isPlan( purchase ) ) {
			description = plan.getDescription();
		} else if ( isTheme( purchase ) && theme ) {
			description = theme.description;
		} else if ( isDomainMapping( purchase ) || isDomainRegistration( purchase ) ) {
			description = translate(
				"Replaces your site's free address with the domain %(domain)s, " +
					'making it easier to remember and easier to share.',
				{
					args: {
						domain: selectedSite.domain,
					},
				}
			);
		} else if ( isDomainTransfer( purchase ) ) {
			description = translate(
				'Transfers an existing domain from another provider to WordPress.com, ' +
					'helping you manage your site and domain in one place.'
			);
		}

		return (
			<div className="manage-purchase__content">
				<span className="manage-purchase__description">{ description }</span>
				{ /* Disconnected sites can't link to their product pages */
				selectedSite && (
					<span className="manage-purchase__settings-link">
						<ProductLink selectedPurchase={ purchase } selectedSite={ selectedSite } />
					</span>
				) }
			</div>
		);
	}

	renderPlaceholder() {
		return (
			<div>
				<PurchaseSiteHeader isPlaceholder />
				<Card className="manage-purchase__info is-placeholder">
					<header className="manage-purchase__header">
						<div className="manage-purchase__plan-icon" />
						<strong className="manage-purchase__title" />
						<span className="manage-purchase__subtitle" />
					</header>
					<div className="manage-purchase__content">
						<span className="manage-purchase__description" />
						<span className="manage-purchase__settings-link" />
					</div>

					<PurchaseMeta purchaseId={ false } />
				</Card>

				{ this.renderPlanDetails() }

				<VerticalNavItem isPlaceholder />
				<VerticalNavItem isPlaceholder />
			</div>
		);
	}

	renderPurchaseDetail() {
		if ( isDataLoading( this.props ) ) {
			return this.renderPlaceholder();
		}

		const { siteId, selectedSite, selectedPurchase } = this.props;
		const purchase = getPurchase( this.props );
		const classes = classNames( 'manage-purchase__info', {
			'is-expired': purchase && isExpired( purchase ),
			'is-personal': isPersonal( purchase ),
			'is-premium': isPremium( purchase ),
			'is-business': isBusiness( purchase ),
		} );
		const siteName = purchase.siteName;
		const siteDomain = purchase.domain;

		return (
			<div>
				<PurchaseSiteHeader siteId={ siteId } name={ siteName } domain={ siteDomain } />
				<Card className={ classes }>
					<header className="manage-purchase__header">
						{ this.renderPlanIcon() }
						<h2 className="manage-purchase__title">{ getName( purchase ) }</h2>
						<div className="manage-purchase__description">{ purchaseType( purchase ) }</div>
						<div className="manage-purchase__price">
							<PlanPrice rawPrice={ purchase.amount } currencyCode={ purchase.currencyCode } />
						</div>
					</header>
					{ this.renderPlanDescription() }

					<PurchaseMeta purchaseId={ selectedPurchase.id } />

					{ this.renderRenewButton() }
				</Card>

				{ this.renderPlanDetails() }

				{ this.renderEditPaymentMethodNavItem() }
				{ this.renderCancelPurchaseNavItem() }
				{ this.renderCancelPrivacyProtection() }

				<RemovePurchase
					hasLoadedSites={ this.props.hasLoadedSites }
					hasLoadedUserPurchasesFromServer={ this.props.hasLoadedUserPurchasesFromServer }
					selectedSite={ selectedSite }
					selectedPurchase={ selectedPurchase }
				/>
			</div>
		);
	}

	render() {
		if ( ! this.isDataValid() ) {
			return null;
		}
		const { selectedSite, siteId, selectedPurchase, isPurchaseTheme } = this.props;
		const classes = 'manage-purchase';

		let editCardDetailsPath = false;
		if (
			! isDataLoading( this.props ) &&
			selectedSite &&
			canEditPaymentDetails( selectedPurchase )
		) {
			editCardDetailsPath = getEditCardDetailsPath( selectedSite.slug, selectedPurchase );
		}

		return (
			<Fragment>
				<QueryUserPurchases userId={ this.props.userId } />
				{ isPurchaseTheme && (
					<QueryCanonicalTheme siteId={ siteId } themeId={ selectedPurchase.meta } />
				) }
				<Main className={ classes }>
					<PageViewTracker
						path="/me/purchases/:site/:purchaseId"
						title="Purchases > Manage Purchase"
					/>
					<HeaderCake backHref={ purchasesRoot }>{ titles.managePurchase }</HeaderCake>
					{
						<PurchaseNotice
							isDataLoading={ isDataLoading( this.props ) }
							handleRenew={ this.handleRenew }
							selectedSite={ selectedSite }
							selectedPurchase={ selectedPurchase }
							editCardDetailsPath={ editCardDetailsPath }
						/>
					}
					{ this.renderPurchaseDetail() }
				</Main>
			</Fragment>
		);
	}
}

export default connect( ( state, props ) => {
	const selectedPurchase = getByPurchaseId( state, props.purchaseId );
	const isPurchasePlan = selectedPurchase && isPlan( selectedPurchase );
	const isPurchaseTheme = selectedPurchase && isTheme( selectedPurchase );
	const siteId = selectedPurchase ? selectedPurchase.siteId : null;
	return {
		hasLoadedSites: ! isRequestingSites( state ),
		hasLoadedUserPurchasesFromServer: hasLoadedUserPurchasesFromServer( state ),
		isAtomicSite: siteId && isSiteAtomic( state, siteId ),
		isPurchaseTheme,
		plan: isPurchasePlan
			? applyTestFiltersToPlansList( selectedPurchase.productSlug, abtest )
			: undefined,
		selectedPurchase,
		selectedSite: getSite( state, siteId ),
		siteId,
		theme: isPurchaseTheme ? getCanonicalTheme( state, siteId, selectedPurchase.meta ) : undefined,
		userId: getCurrentUserId( state ),
	};
} )( localize( ManagePurchase ) );
