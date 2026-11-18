(function (angular) {
    'use strict';

    angular.module('app', []).run(appRun).config(appConfig)
        .constant('OP', {
            /*→ tip_basicOperationsModule_4 ←*/
            /*→ tip_advancedOperationsModule_5 ←*/
        });

    /* @ngInject */
    function appRun($rootScope, OP) {
        angular.isUndefinedOrNull = function (val) {
            return angular.isUndefined(val) || val === null;
        };
        $rootScope.OP = OP;
    }

    /* @ngInject */
    function appConfig() {}

})(window.angular);
